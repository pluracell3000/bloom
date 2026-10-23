import { randomUUID } from "node:crypto";
import { isAuthorized } from "./reader-auth.mjs";
import { normalizeCapture } from "./ingestion.mjs";

export function createCaptureHandler({ readerKey, publish }) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      return res.status(405).json({ error: "method not allowed" });
    }
    if (!readerKey) return res.status(503).json({ error: "capture not configured" });
    if (!isAuthorized(req.headers.authorization, readerKey)) return res.status(401).json({ error: "reader key required" });
    let capture;
    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const text = body?.text;
      if (typeof text !== "string" || !text.trim() || text.length > 10000) throw new Error();
      const value = text.trim();
      const isUrl = /^https?:\/\//i.test(value);
      capture = normalizeCapture({ id: `cap-web-${randomUUID()}`, channel: "web", kind: isUrl ? "url" : "topic", payload: isUrl ? { url: value } : { prompt: value.replace(/^\/topic\s+/i, "") } });
    } catch {
      return res.status(400).json({ error: "Enter one HTTP(S) link or a topic (up to 10,000 characters)." });
    }
    try {
      await publish(capture);
      return res.status(202).json({ status: "queued", captureId: capture.id });
    } catch {
      return res.status(503).json({ error: "Capture could not be queued. Please try again." });
    }
  };
}
