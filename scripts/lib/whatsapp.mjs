import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetchExtractedText } from "./safe-fetch.mjs";
import { normalizeCapture } from "./ingestion.mjs";

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function verifyWebhookChallenge(url, verifyToken) {
  return url.searchParams.get("hub.mode") === "subscribe" &&
    constantTimeEqual(url.searchParams.get("hub.verify_token") || "", verifyToken);
}

export function verifyWebhookSignature(rawBody, signature, appSecret) {
  if (!signature?.startsWith("sha256=") || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(signature, expected);
}

function captureIdForMessage(messageId) {
  return `cap-wa-${createHash("sha256").update(messageId).digest("hex").slice(0, 24)}`;
}

function captureInputFromText(text) {
  const value = text.trim();
  if (!value) return null;
  if (/^\/topic\s+/i.test(value)) {
    return { kind: "topic", payload: { prompt: value.replace(/^\/topic\s+/i, "").trim() } };
  }
  const match = value.match(/https?:\/\/[^\s]+/i);
  if (match) {
    const url = match[0].replace(/[),.;!?]+$/, "");
    const note = `${value.slice(0, match.index)} ${value.slice((match.index || 0) + match[0].length)}`.trim();
    return { kind: "url", payload: { url, note } };
  }
  return { kind: "topic", payload: { prompt: value } };
}

export function parseWhatsAppPayload(payload) {
  const parsed = [];
  if (payload?.object !== "whatsapp_business_account") return parsed;
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const message of Array.isArray(change?.value?.messages) ? change.value.messages : []) {
        if (message?.type !== "text" || typeof message.text?.body !== "string" || typeof message.id !== "string") continue;
        const input = captureInputFromText(message.text.body);
        if (!input) continue;
        const seconds = Number(message.timestamp);
        const received = Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
        const receivedAt = Number.isNaN(received.getTime()) ? new Date().toISOString() : received.toISOString();
        parsed.push({
          providerMessageId: message.id,
          capture: {
            ...input,
            id: captureIdForMessage(message.id),
            channel: "whatsapp",
            received_at: receivedAt,
          },
        });
      }
    }
  }
  return parsed;
}

export async function enqueueWhatsAppPayload(payload, { root, hydrateUrl = fetchExtractedText, logger = console } = {}) {
  if (!root) throw new Error("queue root is required");
  const pendingDir = path.join(root, "inbox", "requests", "pending");
  await mkdir(pendingDir, { recursive: true });
  const results = [];
  for (const item of parseWhatsAppPayload(payload)) {
    const destination = path.join(pendingDir, `${item.capture.id}.json`);
    try {
      await access(destination);
      results.push({ id: item.capture.id, status: "duplicate", path: destination });
      continue;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    let captureInput = item.capture;
    if (captureInput.kind === "url") {
      try {
        const extractedText = await hydrateUrl(captureInput.payload.url);
        captureInput = { ...captureInput, payload: { ...captureInput.payload, extracted_text: extractedText } };
      } catch (error) {
        logger.warn?.(`WhatsApp URL hydration failed for ${captureInput.id}: ${error.message}`);
      }
    }
    const capture = normalizeCapture(captureInput);
    try {
      await writeFile(destination, `${JSON.stringify(capture, null, 2)}\n`, { flag: "wx" });
      results.push({ id: capture.id, status: "queued", path: destination });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      results.push({ id: capture.id, status: "duplicate", path: destination });
    }
  }
  return results;
}
