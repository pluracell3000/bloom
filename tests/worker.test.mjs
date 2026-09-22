import test from "node:test";
import assert from "node:assert/strict";
import { processCapture } from "../scripts/lib/worker.mjs";
import { normalizeCapture } from "../scripts/lib/ingestion.mjs";

const words = Array.from({ length: 320 }, (_, i) => `word${i}`).join(" ");
const NOW = new Date("2026-09-22T12:00:00Z");

function validGenerated(title = "Worker test card") {
  return {
    title, source_type: "topic", source_title: "", source_url: "", author: "", topic_prompt: "worker flow",
    sources: ["https://example.com/a", "https://example.com/b"], tags: ["testing"], tldr: ["First", "Second"],
    pull_quote: "A quote.", recall_question: "Why?", recall_answer: "Because.", body_markdown: words,
  };
}

function topicCapture() {
  return normalizeCapture({ id: "cap-test-topic", kind: "topic", channel: "whatsapp", payload: { prompt: "worker flow" } }, { now: NOW });
}

function urlCapture() {
  return normalizeCapture({ id: "cap-test-url", kind: "url", channel: "whatsapp", payload: { url: "https://example.com/a" } }, { now: NOW });
}

function fakeStore() {
  const cards = new Map();
  const quarantined = [];
  const feeds = [];
  return {
    cards, quarantined, feeds,
    async putCardMarkdown(filename, markdown) { cards.set(filename, markdown); },
    async listCardMarkdown() { return [...cards.entries()].map(([filename, raw]) => ({ filename, raw })); },
    async putFeed(feed) { feeds.push(feed); },
    async putQuarantine(name, record) { quarantined.push({ name, record }); },
  };
}

const silent = { info() {}, warn() {}, error() {} };

test("topic capture flows hydrate-free to a published card and rebuilt feed", async () => {
  const store = fakeStore();
  const prompts = [];
  const result = await processCapture(topicCapture(), {
    generate: async (prompt) => { prompts.push(prompt); return validGenerated(); },
    store,
    logger: silent,
  });
  assert.equal(result.status, "published");
  assert.equal(prompts.length, 1);
  assert.match(prompts[0], /worker flow/);
  assert.equal(store.cards.size, 1);
  assert.equal(store.feeds.length, 1);
  assert.equal(store.feeds[0].card_count, 1);
  assert.equal(store.feeds[0].schema_version, 1);
  assert.equal(store.quarantined.length, 0);
});

test("url capture is hydrated by the connector side before generation", async () => {
  const store = fakeStore();
  const hydrated = [];
  const result = await processCapture(urlCapture(), {
    hydrate: async (url) => { hydrated.push(url); return "extracted article text"; },
    generate: async (prompt) => {
      assert.match(prompt, /extracted article text/);
      return { ...validGenerated("URL card"), source_type: "article", source_title: "A", source_url: "https://example.com/a", author: "B", sources: [] };
    },
    store,
    logger: silent,
  });
  assert.equal(result.status, "published");
  assert.deepEqual(hydrated, ["https://example.com/a"]);
});

test("hydration failure is retryable before the last attempt", async () => {
  const store = fakeStore();
  const error = await processCapture(urlCapture(), {
    hydrate: async () => { throw new Error("blocked"); },
    generate: async () => { throw new Error("must not run"); },
    store,
    logger: silent,
    deliveryCount: 2,
  }).catch((e) => e);
  assert.match(error.message, /blocked/);
  assert.equal(error.retryAfterSeconds, 60);
  assert.equal(store.quarantined.length, 0);
});

test("hydration failure quarantines on the last attempt instead of throwing", async () => {
  const store = fakeStore();
  const result = await processCapture(urlCapture(), {
    hydrate: async () => { throw new Error("blocked"); },
    generate: async () => { throw new Error("must not run"); },
    store,
    logger: silent,
    deliveryCount: 8,
    maxDeliveryAttempts: 8,
  });
  assert.equal(result.status, "quarantined");
  assert.equal(result.step, "hydrate");
  assert.equal(store.quarantined.length, 1);
  assert.equal(store.quarantined[0].name, "cap-test-url.json");
});

test("invalid model output gets exactly one repair attempt, then publishes", async () => {
  const store = fakeStore();
  const prompts = [];
  const result = await processCapture(topicCapture(), {
    generate: async (prompt) => {
      prompts.push(prompt);
      return prompts.length === 1 ? { title: "broken" } : validGenerated();
    },
    store,
    logger: silent,
  });
  assert.equal(result.status, "published");
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /failed Bloom's deterministic card validation/);
  assert.equal(store.quarantined.length, 0);
});

test("two invalid outputs quarantine without publishing", async () => {
  const store = fakeStore();
  const result = await processCapture(topicCapture(), {
    generate: async () => ({ title: "still broken" }),
    store,
    logger: silent,
  });
  assert.equal(result.status, "quarantined");
  assert.equal(result.step, "validate");
  assert.equal(store.cards.size, 0);
  assert.equal(store.feeds.length, 0);
  assert.equal(store.quarantined.length, 1);
});

test("retryable Gemini failures propagate with their backoff", async () => {
  const store = fakeStore();
  const rateLimited = new Error("Gemini request failed (429)");
  rateLimited.retryAfterSeconds = 120;
  const error = await processCapture(topicCapture(), {
    generate: async () => { throw rateLimited; },
    store,
    logger: silent,
    deliveryCount: 1,
  }).catch((e) => e);
  assert.equal(error, rateLimited);
  assert.equal(store.quarantined.length, 0);
});

test("duplicate card filenames quarantine instead of overwriting", async () => {
  const store = fakeStore();
  store.putCardMarkdown = async () => { const e = new Error("blob already exists"); e.name = "BlobPreconditionFailedError"; throw e; };
  const result = await processCapture(topicCapture(), {
    generate: async () => validGenerated(),
    store,
    logger: silent,
  });
  assert.equal(result.status, "quarantined");
  assert.equal(result.step, "publish");
  assert.match(result.reason, /already exists/);
});
