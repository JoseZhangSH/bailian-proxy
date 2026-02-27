// api/generate-image.js（Vercel 函数）- 先用 qwen-plus 优化提示词，再调用 wan2.6-t2i 文生图
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_COUNT = 24; // 最多轮询约 2 分钟

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

let optimizationSystemPromptCache = null;

async function getOptimizationSystemPrompt() {
  if (optimizationSystemPromptCache) return optimizationSystemPromptCache;
  try {
    const filePath = path.join(process.cwd(), "AIGCPromptOptimization");
    const content = await fs.readFile(filePath, "utf-8");
    optimizationSystemPromptCache = content;
    return content;
  } catch (error) {
    console.error("Failed to load AIGCPromptOptimization file", error);
    throw new Error("Failed to load optimization prompt config");
  }
}

function normalizeSizeFromDimensions(dimensions, fallbackSize) {
  if (typeof dimensions !== "string") return fallbackSize;
  const match = dimensions.trim().match(/^(\d+)\s*[xX*]\s*(\d+)$/i);
  if (!match) return fallbackSize;
  const width = match[1];
  const height = match[2];
  return `${width}*${height}`;
}

async function optimizePromptWithQwen({ prompt, size, design_style }) {
  if (!prompt || typeof prompt !== "string") return null;

  const systemPrompt = await getOptimizationSystemPrompt();

  const completion = await openai.chat.completions.create({
    model: "qwen-plus",
    messages: [
      {
        role: "system",
        content: systemPrompt,
      },
      {
        role: "user",
        content: JSON.stringify({
          query: prompt,
          design_style: design_style || null,
        }),
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  let content = completion.choices[0]?.message?.content || "";
  // 处理可能的 Markdown 代码块包裹
  content = content.replace(/```json\n?|```/g, "").trim();

  try {
    const parsed = JSON.parse(content);
    const optimizedPrompt =
      parsed.prompt || parsed.optimized_prompt || parsed.text || null;
    const dimensions =
      parsed.dimensions || parsed.size || parsed.image_size || null;

    return {
      prompt: optimizedPrompt,
      dimensions,
    };
  } catch (e) {
    console.error("Failed to parse optimization result", e, content);
    return null;
  }
}

async function createTask(prompt, options) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  if (!apiKey) throw new Error("Missing DASHSCOPE_API_KEY");

  const {
    size = "1280*1280",
    n = 1,
    prompt_extend = true,
    watermark = false,
    negative_prompt,
    seed,
  } = options || {};

  const body = {
    model: "wan2.6-t2i",
    input: {
      messages: [
        {
          role: "user",
          content: [{ text: prompt }],
        },
      ],
    },
    parameters: {
      enable_interleave: true, // 文生图模式（无输入图）；此模式下 n 固定为 1，用 max_images 控制张数
      prompt_extend,
      watermark,
      n: 1,
      max_images: Math.min(5, Math.max(1, n)),
      size,
    },
  };
  if (negative_prompt != null && negative_prompt !== "") body.parameters.negative_prompt = negative_prompt;
  if (seed != null) body.parameters.seed = seed;

  const res = await fetch(`${DASHSCOPE_BASE}/api/v1/services/aigc/image-generation/generation`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "X-DashScope-Async": "enable",
    },
    body: JSON.stringify(body),
  });

  const data = await res.json();
  if (data.code) throw new Error(data.message || data.code);
  const taskId = data.output?.task_id;
  if (!taskId) throw new Error("No task_id in response");
  return taskId;
}

async function getTaskResult(taskId) {
  const apiKey = process.env.DASHSCOPE_API_KEY;
  const res = await fetch(`${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json();
  if (data.code) throw new Error(data.message || data.code);
  return data;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const { prompt, size, n, prompt_extend, watermark, negative_prompt, seed, design_style } = body || {};

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Missing or empty prompt" });
  }

  try {
    let optimizationResult = null;
    try {
      optimizationResult = await optimizePromptWithQwen({
        prompt,
        size,
        design_style,
      });
    } catch (optError) {
      console.error("Prompt optimization failed, fallback to raw prompt", optError);
    }

    const optimizedPrompt = optimizationResult?.prompt || prompt;
    const recommendedSize = normalizeSizeFromDimensions(
      optimizationResult?.dimensions,
      size
    );
    const finalSize = recommendedSize || size;

    const taskId = await createTask(optimizedPrompt, {
      size: finalSize,
      n,
      prompt_extend,
      watermark,
      negative_prompt,
      seed,
    });

    for (let i = 0; i < MAX_POLL_COUNT; i++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      const result = await getTaskResult(taskId);
      const status = result.output?.task_status;

      if (status === "SUCCEEDED") {
        const choices = result.output?.choices || [];
        const images = choices
          .map((c) => c.message?.content)
          .flat()
          .filter((item) => item && item.type === "image" && item.image)
          .map((item) => ({ url: item.image }));
        return res.status(200).json({ images, usage: result.usage, request_id: result.request_id });
      }
      if (status === "FAILED" || status === "CANCELED") {
        return res.status(500).json({
          error: "Image generation failed",
          task_status: status,
          message: result.message,
          request_id: result.request_id,
        });
      }
    }

    return res.status(202).json({
      message: "Task still in progress",
      task_id: taskId,
      poll_url: `${DASHSCOPE_BASE}/api/v1/tasks/${taskId}`,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Image generation failed",
      detail: error.message,
    });
  }
}
