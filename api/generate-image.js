// api/generate-image.js（Vercel 函数）- 调用 wan2.6-t2i 文生图
const DASHSCOPE_BASE = "https://dashscope.aliyuncs.com";
const POLL_INTERVAL_MS = 5000;
const MAX_POLL_COUNT = 24; // 最多轮询约 2 分钟

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
  const { prompt, size, n, prompt_extend, watermark, negative_prompt, seed } = body || {};

  if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
    return res.status(400).json({ error: "Missing or empty prompt" });
  }

  try {
    const taskId = await createTask(prompt, {
      size,
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
