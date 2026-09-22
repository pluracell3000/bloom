// Vercel Function: private queue consumer for the bloom-captures topic. The
// queue trigger in vercel.json makes this route unreachable from the public
// internet; only Vercel's queue infrastructure can invoke it. Processing is
// one message at a time: hydrate -> Gemini -> validate -> publish to the
// private card store, with bounded retries and quarantine for bad output.

import { QueueClient } from "@vercel/queue";
import { processCapture } from "../../scripts/lib/worker.mjs";
import { generateCardWithGemini } from "../../scripts/lib/gemini-client.mjs";
import { createBlobStore } from "../../scripts/lib/vercel-blob-store.mjs";

const queue = new QueueClient();

export default queue.handleNodeCallback(
  async (capture, metadata) => {
    await processCapture(capture, {
      deliveryCount: metadata.deliveryCount,
      generate: (prompt) => generateCardWithGemini(prompt, {
        apiKey: process.env.BLOOM_GEMINI_API_KEY,
        model: process.env.BLOOM_GEMINI_MODEL,
      }),
      store: createBlobStore({ token: process.env.BLOB_READ_WRITE_TOKEN }),
    });
  },
  {
    // Below the 300s function ceiling so a hung hydration cannot outlive the
    // invocation that holds the message lease.
    visibilityTimeoutSeconds: 280,
    retry: (error) => (error && typeof error.retryAfterSeconds === "number"
      ? { afterSeconds: error.retryAfterSeconds }
      : { afterSeconds: 60 }),
  },
);
