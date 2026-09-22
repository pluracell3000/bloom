import test from "node:test";
import assert from "node:assert/strict";
import { createBlobStore } from "../scripts/lib/vercel-blob-store.mjs";

function textStream(value) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(value));
      controller.close();
    },
  });
}

function fakeBlob({ failPut = null } = {}) {
  const objects = new Map();
  return {
    objects,
    put: failPut || (async (pathname, body, options) => {
      objects.set(pathname, { body: String(body), options });
      return { pathname, url: `https://blob.test/${pathname}` };
    }),
    get: async (pathname, options) => {
      if (!objects.has(pathname)) { const e = new Error("not found"); e.name = "BlobNotFoundError"; throw e; }
      return { stream: textStream(objects.get(pathname).body), blob: { pathname }, options };
    },
    list: async ({ prefix, limit = 1000, cursor } = {}) => {
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const slice = all.slice(start, start + limit);
      return {
        blobs: slice.map((pathname) => ({ pathname })),
        hasMore: start + limit < all.length,
        cursor: String(start + limit),
      };
    },
  };
}

test("requires the store token", () => {
  assert.throws(() => createBlobStore({}), /BLOB_READ_WRITE_TOKEN/);
});

test("writes cards privately and rejects path traversal", async () => {
  const backend = fakeBlob();
  const store = createBlobStore({ token: "t", putImpl: backend.put, getImpl: backend.get, listImpl: backend.list });
  await store.putCardMarkdown("2026-09-22-card.md", "---\ntitle: x\n---\nbody");
  const written = backend.objects.get("cards/2026-09-22-card.md");
  assert.equal(written.options.access, "private");
  assert.equal(written.options.allowOverwrite, false);
  await assert.rejects(store.putCardMarkdown("../escape.md", "x"), /basename/);
});

test("lists card markdown through private reads", async () => {
  const backend = fakeBlob();
  backend.objects.set("cards/a.md", { body: "aaa" });
  backend.objects.set("cards/b.md", { body: "bbb" });
  backend.objects.set("quarantine/skip.json", { body: "{}" });
  const store = createBlobStore({ token: "t", putImpl: backend.put, getImpl: backend.get, listImpl: backend.list });
  const sources = await store.listCardMarkdown();
  assert.deepEqual(sources, [
    { filename: "a.md", raw: "aaa" },
    { filename: "b.md", raw: "bbb" },
  ]);
});

test("overwrites the feed but never cards", async () => {
  const backend = fakeBlob();
  const store = createBlobStore({ token: "t", putImpl: backend.put, getImpl: backend.get, listImpl: backend.list });
  await store.putFeed({ schema_version: 1, cards: [] });
  assert.equal(backend.objects.get("feed.json").options.allowOverwrite, true);
  assert.equal(backend.objects.get("feed.json").options.access, "private");
  const { stream } = await store.getFeed();
  const text = await new Response(stream).text();
  assert.match(text, /schema_version/);
});

test("quarantine records stay private", async () => {
  const backend = fakeBlob();
  const store = createBlobStore({ token: "t", putImpl: backend.put, getImpl: backend.get, listImpl: backend.list });
  await store.putQuarantine("cap-x.json", { capture_id: "cap-x" });
  assert.equal(backend.objects.get("quarantine/cap-x.json").options.access, "private");
  await assert.rejects(store.putQuarantine("bad.txt", {}), /JSON basename/);
});
