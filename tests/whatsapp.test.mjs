import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createWebhookHandler } from "../scripts/whatsapp-webhook.mjs";
import { enqueueWhatsAppPayload, parseWhatsAppPayload, verifyWebhookChallenge, verifyWebhookSignature } from "../scripts/lib/whatsapp.mjs";

function webhook(messages) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages } }] }] };
}

function textMessage(id, body, timestamp = "1789981200") {
  return { id, from: "15551234567", timestamp, type: "text", text: { body } };
}

test("verifies Meta challenge tokens and raw-body signatures", () => {
  const url = new URL("https://example.test/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42");
  assert.equal(verifyWebhookChallenge(url, "verify-me"), true);
  assert.equal(verifyWebhookChallenge(url, "wrong"), false);
  const body = Buffer.from('{"entry":[]}');
  const signature = `sha256=${createHmac("sha256", "secret").update(body).digest("hex")}`;
  assert.equal(verifyWebhookSignature(body, signature, "secret"), true);
  assert.equal(verifyWebhookSignature(body, signature, "wrong"), false);
});

test("maps WhatsApp text and links into deterministic capture envelopes", () => {
  const captures = parseWhatsAppPayload(webhook([
    textMessage("wamid.topic", "/topic why queues absorb bursts"),
    textMessage("wamid.url", "Focus on checkpoints https://www.sqlite.org/wal.html"),
    { id: "wamid.image", type: "image", image: { id: "media" } },
  ]));
  assert.equal(captures.length, 2);
  assert.equal(captures[0].capture.kind, "topic");
  assert.equal(captures[0].capture.payload.prompt, "why queues absorb bursts");
  assert.equal(captures[1].capture.kind, "url");
  assert.equal(captures[1].capture.payload.note, "Focus on checkpoints");
  assert.match(captures[0].capture.id, /^cap-wa-[a-f0-9]{24}$/);
  assert.equal(parseWhatsAppPayload(webhook([textMessage("wamid.topic", "/topic why queues absorb bursts")]))[0].capture.id, captures[0].capture.id);
});

test("hydrates URL captures and treats repeated provider IDs as duplicates", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "bloom-whatsapp-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = webhook([textMessage("wamid.once", "https://example.com/read explain the mechanism")]);
  let hydrationCount = 0;
  const hydrateUrl = async () => { hydrationCount += 1; return "Extracted public article text."; };
  const first = await enqueueWhatsAppPayload(payload, { root, hydrateUrl });
  const second = await enqueueWhatsAppPayload(payload, { root, hydrateUrl });
  assert.equal(first[0].status, "queued");
  assert.equal(second[0].status, "duplicate");
  const stored = JSON.parse(await readFile(first[0].path, "utf8"));
  assert.equal(stored.channel, "whatsapp");
  assert.equal(stored.payload.extracted_text, "Extracted public article text.");
  assert.equal(hydrationCount, 1);
});

test("webhook endpoint rejects bad signatures, acknowledges valid payloads, then queues asynchronously", async (t) => {
  const secret = "app-secret";
  let processed;
  const processedPromise = new Promise((resolve) => { processed = resolve; });
  const server = http.createServer(createWebhookHandler({
    verifyToken: "verify-me",
    appSecret: secret,
    root: process.cwd(),
    logger: { info() {}, warn() {}, error(error) { throw error; } },
    enqueue: async (payload) => { processed(payload); return [{ status: "queued" }]; },
  }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const { port } = server.address();
  const body = Buffer.from(JSON.stringify(webhook([textMessage("wamid.http", "a topic")])));
  const bad = await fetch(`http://127.0.0.1:${port}/webhooks/whatsapp`, { method: "POST", body, headers: { "x-hub-signature-256": "sha256=bad" } });
  assert.equal(bad.status, 401);
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const good = await fetch(`http://127.0.0.1:${port}/webhooks/whatsapp`, { method: "POST", body, headers: { "x-hub-signature-256": signature } });
  assert.equal(good.status, 200);
  assert.equal(await good.text(), "EVENT_RECEIVED");
  assert.deepEqual(await processedPromise, JSON.parse(body));
});
