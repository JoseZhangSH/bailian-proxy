import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

export default async function handler(req, res) {
  // 1. 获取请求头中的 Origin
  const origin = req.headers.origin;

  // 2. 根据官方文档建议，动态设置 CORS
  // 如果请求来自插件 (null)，我们就返回 Access-Control-Allow-Origin: null
  // 这样比硬编码 '*' 对浏览器的兼容性更好
  res.setHeader('Access-Control-Allow-Origin', origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  // 设置预检请求缓存时间（24小时），减少重复的 OPTIONS 请求
  res.setHeader('Access-Control-Max-Age', '86400');

  // 3. 处理预检请求 (OPTIONS)
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  // 兼容不同的 Body 解析情况
  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { text, targetLang } = body || {};

  if (!text || !targetLang) {
    return res.status(400).json({ error: "Missing text or targetLang" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "qwen-plus",
      messages: [
        { role: "system", content: "You are a professional UI copy translator." },
        { role: "user", content: `请将以下 UI 文案翻译为 ${targetLang}：\n${text}` }
      ],
      temperature: 0.3
    });

    const translatedResult = completion.choices[0].message.content;

    res.status(200).json({
      text: translatedResult,
      success: true
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Model call failed", detail: error.message });
  }
}