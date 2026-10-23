import { createHash, createHmac } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";

export function buildLinkBatch(links, runId, now = new Date()) {
  if (!Array.isArray(links) || !links.length || links.length > 20) throw new Error("Provide between 1 and 20 links");
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId || "")) throw new Error("run-id must contain 1–80 letters, numbers, or hyphens");
  const messages = links.map((item) => {
    const url = new URL(typeof item === "string" ? item : item.url);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new Error("Links must be HTTP(S) URLs without credentials");
    const note = typeof item === "object" && typeof item.note === "string" ? item.note.trim() : "";
    const body = [url.href, note].filter(Boolean).join("\n");
    const digest = createHash("sha256").update(body).digest("hex").slice(0, 24);
    return { id: `bloom-link-test-${runId}-${digest}`, type: "text", timestamp: String(Math.floor(now.getTime() / 1000)), text: { body } };
  });
  if (new Set(messages.map((message) => message.id)).size !== messages.length) throw new Error("The link list contains duplicate entries");
  const urls = links.map((item) => new URL(typeof item === "string" ? item : item.url).href);
  if (new Set(urls).size !== urls.length) throw new Error("Use one entry per source URL");
  return { object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { messaging_product: "whatsapp", messages } }] }] };
}

function originFor(baseUrl) {
  const url = new URL(baseUrl);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Use HTTPS, or HTTP on localhost for local tests");
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("base-url must be an origin without credentials, query, or path");
  return url.origin;
}

function sourceKey(url) {
  try {
    const value = new URL(url);
    value.hash = "";
    return value.href;
  } catch { return ""; }
}

async function readFeed(origin, readerKey, fetchImpl) {
  const response = await fetchImpl(`${origin}/api/feed`, {
    headers: { authorization: `Bearer ${readerKey}` },
    redirect: "error", signal: AbortSignal.timeout(15000),
  });
  let feed;
  try { feed = await response.json(); } catch { throw new Error(`Private feed returned HTTP ${response.status} with invalid JSON`); }
  // A configured, authenticated store can be empty before its first capture.
  if (response.status === 404 && feed.error === "feed not seeded yet") return { schema_version: 1, cards: [] };
  if (!response.ok) throw new Error(`Private feed returned HTTP ${response.status}; no successful delivery can be confirmed`);
  if (feed.schema_version !== 1 || !Array.isArray(feed.cards)) throw new Error("Private feed returned an unexpected format");
  return feed;
}

export async function runLinkTest({ baseUrl, links, runId, appSecret, readerKey, timeoutMs = 180000, pollMs = 5000, fetchImpl = fetch, log = console.log }) {
  const origin = originFor(baseUrl);
  if (!appSecret || !readerKey) throw new Error("BLOOM_WHATSAPP_APP_SECRET and BLOOM_READER_KEY are required");
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isFinite(pollMs) || pollMs <= 0) throw new Error("Timeout and polling interval must be positive");
  const payload = buildLinkBatch(links, runId);
  // Fail before submitting anything if the private feed cannot be read.
  const before = await readFeed(origin, readerKey, fetchImpl);
  const oldIds = new Set(before.cards.map((card) => card.id));
  const expected = links.map((item) => sourceKey(typeof item === "string" ? item : item.url));
  const body = JSON.stringify(payload);
  const signature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
  const response = await fetchImpl(`${origin}/api/webhooks/whatsapp`, {
    method: "POST", body, redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { "content-type": "application/json", "x-hub-signature-256": signature },
  });
  if (!response.ok || await response.text() !== "EVENT_RECEIVED") throw new Error(`Webhook did not acknowledge the batch (HTTP ${response.status})`);
  log(`Accepted ${links.length} link(s) through the signed webhook. Waiting for new cards in the private feed…`);
  const deadline = Date.now() + timeoutMs;
  do {
    const feed = await readFeed(origin, readerKey, fetchImpl);
    const delivered = feed.cards.filter((card) => !oldIds.has(card.id) && expected.includes(sourceKey(card.source_url)));
    const missing = expected.filter((url) => !delivered.some((card) => sourceKey(card.source_url) === url));
    if (!missing.length) {
      log(`PASS: ${expected.length}/${expected.length} source links produced new cards in the private feed.`);
      for (const card of delivered) log(`  ${card.title} (${card.source_url})`);
      return { status: "passed", cards: delivered };
    }
    if (Date.now() >= deadline) {
      log(`INCOMPLETE: ${expected.length - missing.length}/${expected.length} new cards found. Missing source links:`);
      for (const url of missing) log(`  ${url}`);
      throw new Error("Timed out waiting for published cards; check queue retries and quarantine. Previously existing cards do not count as delivery.");
    }
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  } while (true);
}

async function main() {
  const { values } = parseArgs({ options: {
    "base-url": { type: "string" }, links: { type: "string", default: "examples/test-links.json" },
    "run-id": { type: "string", default: "link-test-v1" }, send: { type: "boolean", default: false },
    "timeout-seconds": { type: "string", default: "180" },
  } });
  const links = JSON.parse(await readFile(values.links, "utf8"));
  buildLinkBatch(links, values["run-id"]);
  console.log(`Batch ${values["run-id"]}: ${links.length} link(s)`);
  for (const item of links) console.log(`  ${typeof item === "string" ? item : item.url}`);
  if (!values.send) {
    console.log("Dry run only. Add --send and --base-url to submit and verify new cards.");
    return;
  }
  if (!values["base-url"]) throw new Error("--base-url is required with --send");
  await runLinkTest({ baseUrl: values["base-url"], links, runId: values["run-id"],
    appSecret: process.env.BLOOM_WHATSAPP_APP_SECRET, readerKey: process.env.BLOOM_READER_KEY,
    timeoutMs: Number(values["timeout-seconds"]) * 1000 });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    // Do not print HTTP request objects, headers, credentials, or stack traces.
    console.error(`Link test failed: ${error.message}`);
    process.exitCode = 1;
  });
}
