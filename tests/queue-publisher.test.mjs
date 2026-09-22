import test from "node:test";
import assert from "node:assert/strict";
import { CAPTURE_RETENTION_SECONDS, CAPTURE_TOPIC, publishWhatsAppPayload } from "../scripts/lib/queue-publisher.mjs";

function webhook(messages) {
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messages } }] }] };
}

function textMessage(id, body, timestamp = "1789981200") {
  return { id, from: "15551234567", timestamp, type: "text", text: { body } };
}

test("publishes each parsed capture with its id as the idempotency key", async () => {
  const sent = [];
  const results = await publishWhatsAppPayload(
    webhook([textMessage("wamid.1", "/topic sqlite WAL"), textMessage("wamid.2", "read https://example.com/a later")]),
    { sendMessage: async (topic, payload, options) => { sent.push({ topic, payload, options }); return { messageId: `m-${sent.length}` }; } },
  );
  assert.equal(sent.length, 2);
  for (const call of sent) {
    assert.equal(call.topic, CAPTURE_TOPIC);
    assert.equal(call.options.idempotencyKey, call.payload.id);
    assert.equal(call.options.retentionSeconds, CAPTURE_RETENTION_SECONDS);
  }
  assert.deepEqual(results.map((r) => r.status), ["queued", "queued"]);
  assert.deepEqual(results.map((r) => r.messageId), ["m-1", "m-2"]);
});

test("a failed publish throws so the webhook can answer non-200", async () => {
  await assert.rejects(
    publishWhatsAppPayload(webhook([textMessage("wamid.1", "hello there")]), {
      sendMessage: async () => { throw new Error("queue unavailable"); },
      logger: { error() {} },
    }),
    /queue unavailable/,
  );
});

test("non-message payloads publish nothing and do not throw", async () => {
  const results = await publishWhatsAppPayload({ object: "whatsapp_business_account", entry: [] }, { sendMessage: async () => { throw new Error("must not be called"); } });
  assert.deepEqual(results, []);
});
