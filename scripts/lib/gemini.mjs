const CARD_SCHEMA = {
  type: "OBJECT",
  required: ["title", "source_type", "source_title", "source_url", "author", "topic_prompt", "sources", "tags", "tldr", "pull_quote", "recall_question", "recall_answer", "body_markdown"],
  properties: {
    title: { type: "STRING" },
    source_type: { type: "STRING", enum: ["article", "newsletter", "podcast", "video", "book", "topic"] },
    source_title: { type: "STRING" },
    source_url: { type: "STRING" },
    author: { type: "STRING" },
    topic_prompt: { type: "STRING" },
    sources: { type: "ARRAY", items: { type: "STRING" } },
    tags: { type: "ARRAY", items: { type: "STRING" } },
    tldr: { type: "ARRAY", items: { type: "STRING" } },
    pull_quote: { type: "STRING" },
    recall_question: { type: "STRING" },
    recall_answer: { type: "STRING" },
    body_markdown: { type: "STRING" },
  },
};

export function geminiRequest(prompt, { model }) {
  if (!model || !/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error("BLOOM_GEMINI_MODEL is invalid");
  return {
    url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    body: {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
        responseSchema: CARD_SCHEMA,
      },
    },
  };
}

export function parseGeminiResponse(payload) {
  const blockReason = payload?.promptFeedback?.blockReason;
  if (blockReason) throw new Error(`Gemini blocked the prompt (${blockReason})`);
  const candidate = payload?.candidates?.[0];
  const text = candidate?.content?.parts?.map((part) => part?.text || "").join("").trim();
  if (!text) throw new Error(`Gemini returned no card content${candidate?.finishReason ? ` (${candidate.finishReason})` : ""}`);
  try { return JSON.parse(text); } catch { throw new Error("Gemini returned invalid JSON"); }
}
