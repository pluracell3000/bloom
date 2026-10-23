// gemini-client.mjs — server-side Gemini caller for the hosted worker.
// The API key only ever lives in the deployment secret store and is sent in
// the x-goog-api-key header, never the URL, logs, captures, or cards.

import { geminiRequest, parseGeminiResponse } from "./gemini.mjs";

// Never log the provider's raw response: it may echo request data. Keep only
// known diagnostic codes and numeric quota values so failures remain useful
// even when the queue SDK successfully reschedules (and hides) an exception.
const SAFE_REASONS = new Set([
  "API_KEY_INVALID", "API_KEY_EXPIRED", "API_KEY_SERVICE_BLOCKED",
  "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED",
  "SERVICE_DISABLED", "BILLING_DISABLED", "CONSUMER_INVALID",
  "RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED",
]);
const SAFE_STATUSES = new Set([
  "INVALID_ARGUMENT", "UNAUTHENTICATED", "PERMISSION_DENIED", "NOT_FOUND",
  "RESOURCE_EXHAUSTED", "FAILED_PRECONDITION", "INTERNAL", "UNAVAILABLE",
]);

async function failureMessage(response) {
  const codes = [String(response.status)];
  const body = await response.json?.().catch(() => null);
  if (SAFE_STATUSES.has(body?.error?.status)) codes.push(body.error.status);
  for (const detail of body?.error?.details || []) {
    if (SAFE_REASONS.has(detail.reason)) codes.push(detail.reason);
    for (const violation of detail.violations || []) {
      if (/^\d+$/.test(String(violation.quotaValue))) {
        const tier = String(violation.quotaId).includes("FreeTier") ? "free-tier " : "";
        codes.push(`${tier}quota=${violation.quotaValue}`);
      }
    }
  }
  return `Gemini request failed (${[...new Set(codes)].join(", ")})`;
}

/**
 * Generate one card object from a prompt via Gemini's generateContent API.
 * Throws an error with `retryAfterSeconds` set for rate-limit (429) and
 * server (5xx) responses so the queue consumer can back off instead of
 * burning delivery attempts.
 */
export async function generateCardWithGemini(prompt, { apiKey, model, fetchImpl = fetch, logger = console } = {}) {
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
  if (!response.ok) {
    const error = new Error(await failureMessage(response));
    logger.warn?.(error.message);
    if (response.status === 429 || response.status >= 500) error.retryAfterSeconds = 60;
    throw error;
  }
  return parseGeminiResponse(await response.json());
}
