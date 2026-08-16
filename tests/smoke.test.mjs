// Smoke test: boot the real site/app.js in jsdom against the real built
// site/feed.json. Asserts both zones render, opening a card shows the recall
// question, and Done removes the card from Zone A and persists state.

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "site");

async function bootApp() {
  const html = await readFile(path.join(SITE, "index.html"), "utf8");
  const feedJson = await readFile(path.join(SITE, "feed.json"), "utf8");

  const dom = new JSDOM(html, { url: "https://nightstand.test/app/" });
  const { window } = dom;

  globalThis.document = window.document;
  globalThis.window = window;
  globalThis.localStorage = window.localStorage;
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
  window.requestAnimationFrame = globalThis.requestAnimationFrame;

  // navigator is getter-only on globalThis in Node 22 — define, don't assign.
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: "smoke-test" },
    configurable: true,
  });

  // Reduced motion so every transition is instant.
  window.matchMedia = (q) => ({
    matches: q.includes("prefers-reduced-motion"),
    media: q,
    addEventListener() {},
    removeEventListener() {},
  });

  globalThis.fetch = async (url) => {
    if (String(url).endsWith("feed.json")) {
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => JSON.parse(feedJson),
      };
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  window.fetch = globalThis.fetch;

  await import("../site/app.js");
  await window.__nightstandReady;
  return { window, document: window.document, feed: JSON.parse(feedJson) };
}

test("smoke: boots, renders zones, recall works, Done persists", async () => {
  const { document, feed } = await bootApp();

  // Both zones render.
  const zoneA = document.getElementById("zone-a");
  const zoneB = document.getElementById("zone-b");
  assert.ok(zoneA, "Zone A rendered");
  assert.ok(zoneB, "Zone B rendered");

  // Fresh state: every card is unread, so all cards sit in Zone A…
  const cardsA = zoneA.querySelectorAll(".card");
  assert.equal(cardsA.length, feed.cards.length);

  // …and Zone B shows its empty copy.
  assert.match(zoneB.textContent, /Nothing to revisit today\./);

  // The horizon mark is present.
  assert.match(document.querySelector(".horizon").textContent, /Caught up/);

  // Open the first card: body + recall question appear (lazy-rendered).
  const first = cardsA[0];
  const firstCard = feed.cards[0];
  assert.equal(first.querySelector(".card-detail-inner").innerHTML, "", "body is lazy");
  first.querySelector(".open-btn").click();
  assert.ok(first.classList.contains("open"));
  assert.match(first.textContent, new RegExp(firstCard.recall_question.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.ok(first.querySelector(".card-body"), "body rendered on open");

  // Reveal shows the answer.
  first.querySelector(".reveal-btn").click();
  const answer = first.querySelector(".recall-answer");
  assert.ok(answer, "answer appears after Reveal");
  assert.equal(answer.textContent, firstCard.recall_answer);

  // Done removes the card from Zone A…
  first.querySelector(".btn-done").click();
  await new Promise((r) => setTimeout(r, 30)); // let the async handler finish
  const remaining = document.getElementById("zone-a").querySelectorAll(".card");
  assert.equal(remaining.length, feed.cards.length - 1);
  assert.ok(![...remaining].some((el) => el.dataset.id === firstCard.id));

  // …and persists to localStorage.
  const saved = JSON.parse(globalThis.localStorage.getItem("nightstand.state"));
  assert.equal(saved.state_version, 1);
  assert.ok(saved.cards[firstCard.id].first_read, "first_read recorded");
  assert.equal(saved.cards[firstCard.id].retired, false);
});
