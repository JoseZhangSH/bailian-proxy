// api/generate-image.js（Vercel 函数）- 先用 qwen-plus 优化提示词，再调用 seeddream 文生图
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
});

// 火山方舟 seeddream 客户端（OpenAI 协议兼容）
const arkClient = new OpenAI({
  apiKey: process.env.ARK_API_KEY,
  baseURL: "https://ark.cn-beijing.volces.com/api/v3",
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

// 使用火山方舟 seeddream 直接同步生成图片
async function generateImagesWithSeedDream(prompt, options) {
  if (!process.env.ARK_API_KEY) {
    throw new Error("Missing ARK_API_KEY for seeddream");
  }

  const {
    size = "1024x1024",
    n = 1,
    // 目前 seeddream OpenAI 协议主要支持 prompt / size / n 等参数，
    // negative_prompt / seed 如有需要可后续扩展
  } = options || {};

  // 兼容旧的 "宽*高" 或 "宽X高" 写法，统一转成 OpenAI 协议常用的 "宽x高"
  const normalizedSize =
    typeof size === "string"
      ? size.replace(/[*X]/gi, "x")
      : "1024x1024";

  const resp = await arkClient.images.generate({
    prompt,
    model: "doubao-seedream-3-0-t2i-250415",
    response_format: "url",
    size: normalizedSize,
    n: Math.min(5, Math.max(1, n || 1)),
  });

  const images = await Promise.all(
    (resp.data || []).map(async (item) => {
      const url = item.url;
      if (!url) return null;
      try {
        const base64 = await fetchImageAsBase64(url);
        return { url, base64 };
      } catch (e) {
        console.error("Failed to fetch or encode image", url, e);
        return null;
      }
    })
  );

  const filteredImages = images.filter(Boolean);
  if (filteredImages.length === 0) {
    throw new Error("seeddream generation succeeded but no image URL returned");
  }

  return {
    images: filteredImages,
    usage: resp.usage,
    request_id: resp.id || resp.request_id,
  };
}

async function fetchImageAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch image: ${resp.status} ${resp.statusText}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const base64 = Buffer.from(arrayBuffer).toString("base64");
  return base64;
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

    const { images, usage, request_id } = await generateImagesWithSeedDream(
      optimizedPrompt,
      {
        size: finalSize,
        n,
        prompt_extend,
        watermark,
        negative_prompt,
        seed,
      }
    );

    return res.status(200).json({
      images,
      usage,
      request_id,
    });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: "Image generation failed",
      detail: error.message,
    });
  }
}
