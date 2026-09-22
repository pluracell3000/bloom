// worker.mjs — the hosted capture pipeline, one queue message at a time:
// hydrate (connector-side, never the model) -> Gemini -> validate -> one
// repair attempt -> publish card + rebuild feed, else quarantine. All
// effects go through the injected store so the module stays testable and the
// storage provider stays replaceable.

import { buildFeedFromSources } from "../build-feed.mjs";
import { buildCardPrompt, captureNeedsContent, normalizeCapture, renderCard } from "./ingestion.mjs";
import { fetchExtractedText } from "./safe-fetch.mjs";

export const MAX_DELIVERY_ATTEMPTS = 8;

function retryable(message, afterSeconds = 60) {
  const error = new Error(message);
  error.retryAfterSeconds = afterSeconds;
  return error;
}

function buildRepairPrompt(prompt, validationMessage) {
  return [
    prompt,
    "Your previous answer failed Bloom's deterministic card validation with:",
    validationMessage,
    "Return one corrected JSON object only, fixing every listed violation.",
  ].join("\n\n");
}

async function quarantine(store, capture, step, reason, logger) {
  const record = {
    schema_version: 1,
    capture_id: capture.id,
    step,
    reason,
    quarantined_at: new Date().toISOString(),
    capture,
  };
  await store.putQuarantine(`${capture.id}.json`, record);
  logger.warn?.(`capture ${capture.id} quarantined at ${step}: ${reason}`);
  return { status: "quarantined", captureId: capture.id, step, reason };
}

/**
 * Process one queued capture. Throws (with retryAfterSeconds when the failure
 * is transient) so the queue redelivers; quarantines and acknowledges once a
 * failure is permanent or the delivery budget is spent.
 */
export async function processCapture(captureInput, {
  hydrate = fetchExtractedText,
  generate,
  store,
  logger = console,
  deliveryCount = 1,
  maxDeliveryAttempts = MAX_DELIVERY_ATTEMPTS,
} = {}) {
  if (typeof generate !== "function") throw new Error("a generate(prompt) function is required");
  if (!store) throw new Error("a card store is required");
  const capture = normalizeCapture(captureInput);
  const lastAttempt = deliveryCount >= maxDeliveryAttempts;

  if (captureNeedsContent(capture)) {
    try {
      const extractedText = await hydrate(capture.payload.url);
      capture.payload.extracted_text = extractedText;
    } catch (error) {
      if (lastAttempt) return quarantine(store, capture, "hydrate", error.message, logger);
      throw retryable(`URL hydration failed: ${error.message}`);
    }
  }

  const prompt = buildCardPrompt(capture);
  let generated;
  try {
    generated = await generate(prompt);
  } catch (error) {
    if (lastAttempt) return quarantine(store, capture, "generate", error.message, logger);
    throw error.retryAfterSeconds ? error : retryable(error.message);
  }

  let card;
  try {
    card = renderValidCard(capture, generated);
  } catch (firstError) {
    let repaired;
    try {
      repaired = await generate(buildRepairPrompt(prompt, firstError.message));
    } catch (error) {
      if (lastAttempt) return quarantine(store, capture, "generate", error.message, logger);
      throw error.retryAfterSeconds ? error : retryable(error.message);
    }
    try {
      card = renderValidCard(capture, repaired);
    } catch (secondError) {
      return quarantine(store, capture, "validate", secondError.message, logger);
    }
  }

  try {
    await store.putCardMarkdown(card.filename, card.markdown);
  } catch (error) {
    if (error.name === "BlobPreconditionFailedError" || /already exists/i.test(error.message)) {
      return quarantine(store, capture, "publish", `card already exists: ${card.filename}`, logger);
    }
    if (lastAttempt) return quarantine(store, capture, "publish", error.message, logger);
    throw retryable(`card publish failed: ${error.message}`);
  }

  const feed = buildFeedFromSources(await store.listCardMarkdown());
  await store.putFeed(feed);
  logger.info?.(`capture ${capture.id} published as ${card.id}`);
  return { status: "published", captureId: capture.id, cardId: card.id, cardCount: feed.card_count };
}

// renderCard runs the deterministic validator and throws listing violations.
function renderValidCard(capture, generated) {
  return renderCard(capture, generated);
}
