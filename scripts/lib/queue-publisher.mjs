// queue-publisher.mjs — publish normalized captures to the durable Vercel
// Queues topic instead of the local filesystem queue. Used only by the hosted
// webhook; the local CLI flow keeps writing to inbox/requests/pending/.

import { send } from "@vercel/queue";
import { parseWhatsAppPayload } from "./whatsapp.mjs";

export const CAPTURE_TOPIC = "bloom-captures";
// Retain for the maximum window so idempotency keys dedupe Meta webhook
// retries for the message's whole lifetime.
export const CAPTURE_RETENTION_SECONDS = 7 * 24 * 60 * 60;

/**
 * Parse a WhatsApp webhook payload and publish each capture to the queue.
 * Idempotency keys make Meta's at-least-once webhook retries harmless.
 * Throws if a publish fails so the webhook answers non-200 and Meta retries.
 */
export async function publishWhatsAppPayload(payload, { sendMessage = send, logger = console } = {}) {
  const results = [];
  for (const item of parseWhatsAppPayload(payload)) {
    try {
      const { messageId } = await sendMessage(CAPTURE_TOPIC, item.capture, {
        idempotencyKey: item.capture.id,
        retentionSeconds: CAPTURE_RETENTION_SECONDS,
      });
      results.push({ id: item.capture.id, status: "queued", messageId });
    } catch (error) {
      logger.error?.(`queue publish failed for ${item.capture.id}: ${error.message}`);
      throw error;
    }
  }
  return results;
}
