import test from "node:test";
import assert from "node:assert/strict";
import { generateCardWithGemini } from "../scripts/lib/gemini-client.mjs";
import { geminiRequest } from "../scripts/lib/gemini.mjs";

function geminiResponse(body) {
  return {
    candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] }, finishReason: "STOP" }],
  };
}

const card = { title: "T", source_type: "topic", sources: [], tags: ["a"], tldr: ["a", "b"], pull_quote: "q", recall_question: "q", recall_answer: "a", body_markdown: "b", source_title: "", source_url: "", author: "", topic_prompt: "p" };

test("sends the key in the header and parses the structured card", async () => {
  const calls = [];
  const generated = await generateCardWithGemini("make a card", {
    apiKey: "secret-key",
    model: "gemini-2.5-flash",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, json: async () => geminiResponse(card) };
    },
  });
  assert.deepEqual(generated, card);
  assert.equal(calls.length, 1);
  const expected = geminiRequest("make a card", { model: "gemini-2.5-flash" });
  assert.equal(calls[0].url, expected.url);
  assert.equal(calls[0].options.headers["x-goog-api-key"], "secret-key");
  assert.equal(calls[0].url.includes("secret-key"), false);
});

test("requires an API key", async () => {
  await assert.rejects(generateCardWithGemini("p", { model: "gemini-2.5-flash" }), /BLOOM_GEMINI_API_KEY/);
});

test("429 and 5xx are retryable with a backoff hint", async () => {
  for (const status of [429, 500, 503]) {
    const error = await generateCardWithGemini("p", { apiKey: "k", model: "gemini-2.5-flash", fetchImpl: async () => ({ ok: false, status }) }).catch((e) => e);
    assert.match(error.message, new RegExp(String(status)));
    assert.equal(error.retryAfterSeconds, 60);
  }
});

test("network failures are retryable", async () => {
  const error = await generateCardWithGemini("p", { apiKey: "k", model: "gemini-2.5-flash", fetchImpl: async () => { throw new Error("socket hangup"); } }).catch((e) => e);
  assert.match(error.message, /socket hangup/);
  assert.equal(error.retryAfterSeconds, 60);
});

test("other client errors are permanent", async () => {
  const error = await generateCardWithGemini("p", { apiKey: "k", model: "gemini-2.5-flash", fetchImpl: async () => ({ ok: false, status: 400 }) }).catch((e) => e);
  assert.match(error.message, /400/);
  assert.equal(error.retryAfterSeconds, undefined);
});
