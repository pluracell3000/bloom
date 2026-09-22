import test from "node:test";
import assert from "node:assert/strict";
import { geminiRequest, parseGeminiResponse } from "../scripts/lib/gemini.mjs";

test("builds a structured Gemini generateContent request", () => {
  const request = geminiRequest("make a card", { model: "gemini-2.5-flash" });
  assert.match(request.url, /gemini-2.5-flash:generateContent$/);
  assert.equal(request.body.generationConfig.responseMimeType, "application/json");
  assert.equal(request.body.generationConfig.responseSchema.type, "OBJECT");
  assert.throws(() => geminiRequest("x", { model: "../bad" }), /invalid/);
});

test("parses Gemini text and reports blocked or malformed responses", () => {
  assert.deepEqual(parseGeminiResponse({ candidates: [{ content: { parts: [{ text: '{"title":"A"}' }] } }] }), { title: "A" });
  assert.throws(() => parseGeminiResponse({ promptFeedback: { blockReason: "SAFETY" } }), /blocked/);
  assert.throws(() => parseGeminiResponse({ candidates: [{ content: { parts: [{ text: "nope" }] } }] }), /invalid JSON/);
});
