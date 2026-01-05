import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

export default async function handler(req, res) {
  // 1️⃣ 统一处理 CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  // 2️⃣ 处理浏览器预检请求
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // 3️⃣ 只允许 POST
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Only POST allowed" });
  }

  const { text, targetLang } = req.body;
  if (!text || !targetLang) {
    return res.status(400).json({ error: "Missing text or targetLang" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "qwen-plus",
      messages: [
        { role: "system", content: "You are a professional UI copy translator." },
        { role: "user", content: `请将以下文案翻译为 ${targetLang}：\n${text}` }
      ],
      temperature: 0.3
    });

    res.status(200).json({
      result: completion.choices[0].message.content
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Model call failed", detail: err.message });
  }
}
