import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { buildLinkBatch, runLinkTest } from "../scripts/test-links.mjs";
import { createWebhookHandler } from "../scripts/whatsapp-webhook.mjs";
import { publishWhatsAppPayload } from "../scripts/lib/queue-publisher.mjs";
import { processCapture } from "../scripts/lib/worker.mjs";

const links = [{ url: "https://www.sqlite.org/wal.html", note: "Explain the checkpoint tradeoff." }];
const silent = { info() {}, warn() {}, error() {} };

test("fixed batch IDs survive a resend but change when a link or run changes", () => {
  const messages = (batch) => batch.entry[0].changes[0].value.messages;
  const first = messages(buildLinkBatch(links, "smoke", new Date("2026-10-23")));
  const retry = messages(buildLinkBatch(links, "smoke", new Date("2026-10-24")));
  assert.equal(first[0].id, retry[0].id);
  assert.notEqual(first[0].id, messages(buildLinkBatch(links, "another-run"))[0].id);
  assert.throws(() => buildLinkBatch(["https://user:password@example.com/"], "smoke"), /without credentials/);
  assert.throws(() => buildLinkBatch([...links, ...links], "smoke"), /duplicate/);
  assert.throws(() => buildLinkBatch([links[0], { ...links[0], note: "another angle" }], "smoke"), /one entry per source/);
});

test("an unreadable private feed stops the batch before any messages are submitted", async () => {
  const requests = [];
  await assert.rejects(runLinkTest({
    baseUrl: "https://bloom.example", links, runId: "smoke", appSecret: "test-secret", readerKey: "test-reader",
    fetchImpl: async (url, options) => { requests.push({ url, method: options.method || "GET" }); return Response.json({ error: "not configured" }, { status: 503 }); },
  }), /HTTP 503/);
  assert.deepEqual(requests.map((request) => request.method), ["GET"]);
});

test("signed link batch reaches the real parser, publisher, worker, and feed; existing cards do not count", async (t) => {
  const fixture = JSON.parse(await readFile(new URL("../examples/sqlite-wal-review/response.json", import.meta.url), "utf8"));
  const cards = new Map();
  let feed = { schema_version: 1, cards: [{ id: "old-card", source_url: links[0].url }] };
  const pending = [];
  const seen = new Set();
  const hydrated = [];
  const store = {
    async putCardMarkdown(filename, raw) { cards.set(filename, raw); },
    async listCardMarkdown() { return [...cards].map(([filename, raw]) => ({ filename, raw })); },
    async putFeed(value) { feed = value; },
    async putQuarantine() { throw new Error("Unexpected quarantine"); },
  };
  const handler = createWebhookHandler({ verifyToken: "test-verify", appSecret: "test-secret", path: "/api/webhooks/whatsapp", awaitEnqueue: true, logger: silent,
    enqueue: (payload) => publishWhatsAppPayload(payload, { logger: silent, sendMessage: async (_topic, capture, options) => {
      if (!seen.has(options.idempotencyKey)) {
        seen.add(options.idempotencyKey);
        pending.push(capture);
      }
      return { messageId: "local-queue-id" };
    } }),
  });
  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/feed") {
      if (req.headers.authorization !== "Bearer test-reader") return res.writeHead(401).end();
      if (pending.length) await processCapture(pending.shift(), {
        store, logger: silent,
        hydrate: async (url) => { hydrated.push(url); return "The source explains WAL and checkpointing."; },
        generate: async () => fixture,
      });
      return res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(feed));
    }
    await handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const logs = [];
  const result = await runLinkTest({ baseUrl: `http://127.0.0.1:${server.address().port}`, links, runId: "smoke", appSecret: "test-secret", readerKey: "test-reader", pollMs: 1, timeoutMs: 1000, log: (line) => logs.push(line) });
  assert.equal(result.status, "passed");
  assert.equal(result.cards.length, 1);
  assert.notEqual(result.cards[0].id, "old-card");
  assert.deepEqual(hydrated, [links[0].url]);
  assert.equal(cards.size, 1);
  assert.ok(logs.some((line) => line.startsWith("PASS:")));
  assert.ok(logs.every((line) => !line.includes("test-secret") && !line.includes("test-reader")));
});

test("an authenticated empty store can receive its first card, but a stale card cannot pass", async () => {
  let calls = 0;
  const fetchImpl = async (_url, options) => {
    if (options.method === "POST") return new Response("EVENT_RECEIVED");
    calls++;
    return calls === 1
      ? Response.json({ error: "feed not seeded yet" }, { status: 404 })
      : Response.json({ schema_version: 1, cards: [{ id: "new-card", source_url: links[0].url }] });
  };
  const options = { baseUrl: "https://bloom.example", links, runId: "smoke", appSecret: "test-secret", readerKey: "test-reader", pollMs: 1, timeoutMs: 10, log() {} };
  assert.equal((await runLinkTest({ ...options, fetchImpl })).status, "passed");
  await assert.rejects(runLinkTest({ ...options, fetchImpl: async (_url, options) => options.method === "POST"
    ? new Response("EVENT_RECEIVED")
    : Response.json({ schema_version: 1, cards: [{ id: "old-card", source_url: links[0].url }] }) }), /Timed out/);
});
