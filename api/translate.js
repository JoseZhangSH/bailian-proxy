import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

export default async function handler(req, res) {
  // 1. 添加 CORS 响应头，允许 MasterGo 的 null 源访问
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // 2. 处理预检请求 (OPTIONS)
  // 浏览器在发送 POST 前会先发 OPTIONS，如果不返回 200，请求会被浏览器拦截
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  // 3. 兼容多种 Body 格式（确保 curl 和 fetch 都能正确解析）
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { text, targetLang } = body || {};

  if (!text || !targetLang) {
    return res.status(400).json({ error: "Missing text or targetLang" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "qwen-plus",
      messages: [
        {
          role: "system",
          content: "You are a professional UI copy translator for digital products."
        },
        {
          role: "user",
          content: `请将以下 UI 文案翻译为 ${targetLang}，要求自然、简洁、符合产品界面使用习惯，不要解释：\n${text}`
        }
      ],
      temperature: 0.3
    });

    const translatedResult = completion.choices[0].message.content;

    // 4. 返回 JSON，使用 'text' 作为键，与插件端的逻辑匹配
    res.status(200).json({
      text: translatedResult,
      result: translatedResult // 保留 result 以便兼容旧逻辑
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Model call failed",
      detail: error.message
    });
  }
}