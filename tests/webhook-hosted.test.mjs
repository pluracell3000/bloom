import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import http from "node:http";
import { createWebhookHandler } from "../scripts/whatsapp-webhook.mjs";

function webhook(messages) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages } }] }] };
}

function textMessage(id, body, timestamp = "1789981200") {
  return { id, from: "15551234567", timestamp, type: "text", text: { body } };
}

async function serve(t, options) {
  const server = http.createServer(createWebhookHandler({ verifyToken: "verify-me", appSecret: "app-secret", ...options }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

function signed(body, secret = "app-secret") {
  return { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body).digest("hex")}` };
}

test("hosted mode honors a custom endpoint path", async (t) => {
  const port = await serve(t, {
    path: "/api/webhooks/whatsapp",
    enqueue: async () => [],
  });
  const body = Buffer.from(JSON.stringify(webhook([])));
  const wrongPath = await fetch(`http://127.0.0.1:${port}/webhooks/whatsapp`, { method: "POST", body, headers: signed(body) });
  assert.equal(wrongPath.status, 404);
  const rightPath = await fetch(`http://127.0.0.1:${port}/api/webhooks/whatsapp`, { method: "POST", body, headers: signed(body) });
  assert.equal(rightPath.status, 200);
});

test("hosted mode awaits the enqueue and answers 500 so Meta retries on publish failure", async (t) => {
  const port = await serve(t, {
    path: "/api/webhooks/whatsapp",
    awaitEnqueue: true,
    logger: { info() {}, warn() {}, error() {} },
    enqueue: async () => { throw new Error("queue down"); },
  });
  const body = Buffer.from(JSON.stringify(webhook([textMessage("wamid.x", "hello")])));
  const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whatsapp`, { method: "POST", body, headers: signed(body) });
  assert.equal(res.status, 500);
});

test("hosted mode enqueues before acknowledging", async (t) => {
  const order = [];
  const port = await serve(t, {
    path: "/api/webhooks/whatsapp",
    awaitEnqueue: true,
    enqueue: async (payload) => { order.push("enqueued"); return [{ status: "queued" }]; },
  });
  const body = Buffer.from(JSON.stringify(webhook([textMessage("wamid.x", "hello")])));
  const res = await fetch(`http://127.0.0.1:${port}/api/webhooks/whatsapp`, { method: "POST", body, headers: signed(body) });
  assert.equal(res.status, 200);
  order.push("responded");
  assert.deepEqual(order, ["enqueued", "responded"]);
});

test("challenge verification works on the hosted path", async (t) => {
  const port = await serve(t, { path: "/api/webhooks/whatsapp", enqueue: async () => [] });
  const ok = await fetch(`http://127.0.0.1:${port}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), "42");
  const bad = await fetch(`http://127.0.0.1:${port}/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`);
  assert.equal(bad.status, 403);
});
