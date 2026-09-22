// vercel-seed-blob.mjs — one-time seed of the private hosted card store from
// the repo's local cards/. Run with BLOB_READ_WRITE_TOKEN set (copy it from
// the Vercel project's Blob store settings; never commit it):
//
//   BLOB_READ_WRITE_TOKEN=... node scripts/vercel-seed-blob.mjs
//
// Existing blobs are not overwritten; the feed is always rebuilt from the
// full store contents afterwards.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildFeedFromSources } from "./build-feed.mjs";
import { createBlobStore } from "./lib/vercel-blob-store.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const store = createBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN });

const files = (await readdir(path.join(ROOT, "cards"))).filter((f) => f.endsWith(".md")).sort();
let uploaded = 0;
for (const file of files) {
  const markdown = await readFile(path.join(ROOT, "cards", file), "utf8");
  try {
    await store.putCardMarkdown(file, markdown);
    uploaded += 1;
    console.log(`uploaded ${file}`);
  } catch (error) {
    if (error.name === "BlobPreconditionFailedError" || /already exists/i.test(error.message)) {
      console.log(`kept existing ${file}`);
      continue;
    }
    throw error;
  }
}
const feed = buildFeedFromSources(await store.listCardMarkdown());
await store.putFeed(feed);
console.log(`done: ${uploaded} card(s) uploaded, feed rebuilt with ${feed.card_count} card(s)`);
