// api/translate.js (Vercel 函数)
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Only POST allowed" });

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const { texts, targetLang } = body || {};

  if (!texts || !Array.isArray(texts) || texts.length === 0) {
    return res.status(400).json({ error: "Missing texts array" });
  }

  if (!targetLang) {
    return res.status(400).json({ error: "Missing targetLang" });
  }

  try {
    const completion = await openai.chat.completions.create({
      model: "qwen-plus",
      messages: [
        {
          role: "system",
          content: "You are a professional UI copy translator. I will provide an array of strings. Please translate them into the target language. Return a JSON object with a 'translations' key containing the array of translated strings in the same order."
        },
        {
          role: "user",
          content: `Target Language: ${targetLang}\nTexts to translate: ${JSON.stringify(texts)}`
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.1
    });

    let content = completion.choices[0].message.content;
    
    // 解析模型返回的 JSON（处理可能的 Markdown 代码块包裹）
    content = content.replace(/```json\n?|```/g, "").trim();
    
    const result = JSON.parse(content);
    // 提取翻译数组：优先寻找 translations 键，如果本身就是数组则直接使用
    const translatedArray = result.translations || (Array.isArray(result) ? result : Object.values(result)[0]);

    res.status(200).json({ results: translatedArray });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Batch translation failed", detail: error.message });
  }
}