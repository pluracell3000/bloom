// Vercel Function: private feed API. Streams the compiled feed from the
// private Blob store to browsers presenting the reader key. Without
// BLOOM_READER_KEY configured this fails closed; without a store the reader
// falls back to the public static sample feed.

import { isAuthorized } from "../scripts/lib/reader-auth.mjs";
import { createBlobStore } from "../scripts/lib/vercel-blob-store.mjs";

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "method not allowed" });
    return;
  }
  const readerKey = process.env.BLOOM_READER_KEY;
  if (!readerKey) {
    res.status(503).json({ error: "feed api is not configured" });
    return;
  }
  if (!isAuthorized(req.headers.authorization, readerKey)) {
    res.setHeader("Cache-Control", "no-store");
    res.status(401).json({ error: "reader key required" });
    return;
  }
  try {
    const store = createBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN });
    const { stream } = await store.getFeed();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.status(200);
    await new Response(stream).text().then((body) => res.send(body));
  } catch (error) {
    if (error.name === "BlobNotFoundError") {
      res.status(404).json({ error: "feed not seeded yet" });
      return;
    }
    res.status(500).json({ error: "feed unavailable" });
  }
}
