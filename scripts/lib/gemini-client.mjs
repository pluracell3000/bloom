// gemini-client.mjs — server-side Gemini caller for the hosted worker.
// The API key only ever lives in the deployment secret store and is sent in
// the x-goog-api-key header, never the URL, logs, captures, or cards.

import { geminiRequest, parseGeminiResponse } from "./gemini.mjs";

/**
 * Generate one card object from a prompt via Gemini's generateContent API.
 * Throws an error with `retryAfterSeconds` set for rate-limit (429) and
 * server (5xx) responses so the queue consumer can back off instead of
 * burning delivery attempts.
 */
export async function generateCardWithGemini(prompt, { apiKey, model, fetchImpl = fetch } = {}) {
  if (!apiKey) throw new Error("BLOOM_GEMINI_API_KEY is required");
  const request = geminiRequest(prompt, { model });
  let response;
  try {
    response = await fetchImpl(request.url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(request.body),
    });
  } catch (error) {
    const networkError = new Error(`Gemini request failed: ${error.message}`);
    networkError.retryAfterSeconds = 60;
    throw networkError;
  }
  if (response.status === 429 || response.status >= 500) {
    const retryable = new Error(`Gemini request failed (${response.status})`);
    retryable.retryAfterSeconds = 60;
    throw retryable;
  }
  if (!response.ok) throw new Error(`Gemini request failed (${response.status})`);
  return parseGeminiResponse(await response.json());
}
