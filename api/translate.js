import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
});

export default async function handler(req, res) {
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
        {
          role: "system",
          content:
            "You are a professional UI copy translator for digital products."
        },
        {
          role: "user",
          content: `请将以下 UI 文案翻译为 ${targetLang}，要求自然、简洁、符合产品界面使用习惯，不要解释：\n${text}`
        }
      ],
      temperature: 0.3
    });

    res.status(200).json({
      result: completion.choices[0].message.content
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      error: "Model call failed",
      detail: error.message
    });
  }
}
