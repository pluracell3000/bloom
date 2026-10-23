import { send } from "@vercel/queue";
import { createCaptureHandler } from "../scripts/lib/capture-handler.mjs";
import { CAPTURE_TOPIC, CAPTURE_RETENTION_SECONDS } from "../scripts/lib/queue-publisher.mjs";

export default createCaptureHandler({
  readerKey: process.env.BLOOM_READER_KEY,
  publish: (capture) => send(CAPTURE_TOPIC, capture, {
    idempotencyKey: capture.id,
    retentionSeconds: CAPTURE_RETENTION_SECONDS,
  }),
});
