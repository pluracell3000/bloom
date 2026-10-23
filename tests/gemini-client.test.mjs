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
  assert.match(error.message, /network failure/);
  assert.equal(error.retryAfterSeconds, 60);
});

test("timeouts abort generation and network errors cannot leak secrets", async () => {
  const error = await generateCardWithGemini("private prompt", {
    apiKey: "private-key", model: "gemini-2.5-flash", timeoutMs: 5,
    fetchImpl: async (_url, { signal }) => new Promise((resolve, reject) => {
      const keepAlive = setTimeout(resolve, 1000);
      signal.addEventListener("abort", () => { clearTimeout(keepAlive); reject(signal.reason); });
    }),
  }).catch(e => e);
  assert.match(error.message, /timed out/);
  assert.equal(error.retryAfterSeconds, 60);
  const network = await generateCardWithGemini("private prompt", {
    apiKey: "private-key", model: "gemini-2.5-flash",
    fetchImpl: async () => { throw new Error("private-key private prompt"); },
  }).catch(e => e);
  assert.doesNotMatch(network.message, /private-key|private prompt/);
});

test("other client errors are permanent", async () => {
  const error = await generateCardWithGemini("p", { apiKey: "k", model: "gemini-2.5-flash", fetchImpl: async () => ({ ok: false, status: 400 }) }).catch((e) => e);
  assert.match(error.message, /400/);
  assert.equal(error.retryAfterSeconds, undefined);
});

test("reports safe provider diagnostics without logging response text, prompts, or keys", async () => {
  const logs = [];
  const error = await generateCardWithGemini("private prompt", {
    apiKey: "private-key",
    model: "gemini-2.5-flash",
    logger: { warn: (message) => logs.push(message) },
    fetchImpl: async () => ({
      ok: false, status: 429,
      json: async () => ({ error: {
        message: "private-key private prompt",
        status: "RESOURCE_EXHAUSTED",
        details: [
          { reason: "QUOTA_EXCEEDED" },
          { reason: "private-key" },
          { violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue: "0" }] },
        ],
      } }),
    }),
  }).catch((e) => e);
  assert.equal(error.message, "Gemini request failed (429, RESOURCE_EXHAUSTED, QUOTA_EXCEEDED, free-tier quota=0)");
  assert.deepEqual(logs, [error.message]);
  assert.equal(error.retryAfterSeconds, 60);
  assert.doesNotMatch(JSON.stringify(logs), /private-key|private prompt/);
});
