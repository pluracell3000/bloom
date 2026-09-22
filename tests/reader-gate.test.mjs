// Reader gate: on a hosted deployment /api/feed answers 401, the app renders
// the key gate, and submitting the key retries with a bearer token and
// renders the private feed. The key is stored on-device only.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");

test("401 from /api/feed renders the gate; the key unlocks the feed", async () => {
  const html = await readFile(path.join(SITE, "index.html"), "utf8");
  const feedJson = await readFile(path.join(SITE, "feed.json"), "utf8");

  const dom = new JSDOM(html, { url: "https://nightstand.vercel.app/" });
  const { window } = dom;

  globalThis.document = window.document;
  globalThis.window = window;
  globalThis.localStorage = window.localStorage;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  Object.defineProperty(globalThis, "navigator", { value: { userAgent: "gate-test" }, configurable: true });
  window.matchMedia = (q) => ({ matches: true, media: q, addEventListener() {}, removeEventListener() {} });

  const seen = [];
  globalThis.fetch = async (url, options = {}) => {
    seen.push({ url: String(url), auth: options.headers?.Authorization || null });
    if (String(url) === "/api/feed") {
      const authorized = options.headers?.Authorization === "Bearer secret-reader-key";
      return {
        ok: authorized,
        status: authorized ? 200 : 401,
        headers: { get: () => "application/json" },
        json: async () => (authorized ? JSON.parse(feedJson) : { error: "reader key required" }),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.fetch = globalThis.fetch;

  await import("../site/app.js");

  // The gate renders instead of the feed.
  await new Promise((r) => setTimeout(r, 20));
  const gate = window.document.querySelector(".reader-gate");
  assert.ok(gate, "reader key gate rendered");
  assert.match(gate.textContent, /private/);

  // Submitting the key retries with the bearer token and renders the feed.
  window.document.getElementById("reader-key-input").value = "secret-reader-key";
  window.document.getElementById("reader-key-form").dispatchEvent(new window.Event("submit", { cancelable: true }));
  await window.__nightstandReady;

  assert.equal(globalThis.localStorage.getItem("nightstand.readerKey"), "secret-reader-key");
  assert.deepEqual(seen.map((s) => [s.url, s.auth]), [
    ["/api/feed", null],
    ["/api/feed", "Bearer secret-reader-key"],
  ]);
  const zoneA = window.document.getElementById("zone-a");
  assert.ok(zoneA.querySelectorAll(".card").length > 0, "feed rendered after unlock");
});
