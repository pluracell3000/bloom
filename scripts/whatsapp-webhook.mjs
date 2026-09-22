import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { enqueueWhatsAppPayload, verifyWebhookChallenge, verifyWebhookSignature } from "./lib/whatsapp.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_WEBHOOK_BYTES = 1024 * 1024;

function readBody(request, maxBytes = MAX_WEBHOOK_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        tooLarge = true;
        reject(Object.assign(new Error("webhook body is too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
    request.on("error", reject);
  });
}

export function createWebhookHandler({ verifyToken, appSecret, root = ROOT, logger = console, enqueue = enqueueWhatsAppPayload }) {
  if (!verifyToken || !appSecret) throw new Error("WhatsApp verify token and app secret are required");
  return async function webhookHandler(request, response) {
    const url = new URL(request.url || "/", "http://localhost");
    if (url.pathname !== "/webhooks/whatsapp") {
      response.writeHead(404).end("Not found");
      return;
    }
    if (request.method === "GET") {
      if (!verifyWebhookChallenge(url, verifyToken)) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      response.writeHead(200, { "Content-Type": "text/plain" }).end(url.searchParams.get("hub.challenge") || "");
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, { Allow: "GET, POST" }).end("Method not allowed");
      return;
    }
    try {
      const rawBody = await readBody(request);
      if (!verifyWebhookSignature(rawBody, request.headers["x-hub-signature-256"], appSecret)) {
        response.writeHead(401).end("Invalid signature");
        return;
      }
      const payload = JSON.parse(rawBody.toString("utf8"));
      response.writeHead(200, { "Content-Type": "text/plain" }).end("EVENT_RECEIVED");
      setImmediate(() => enqueue(payload, { root, logger }).then(
        (results) => logger.info?.(`WhatsApp webhook processed: ${results.length} message(s)`),
        (error) => logger.error?.("WhatsApp webhook processing failed", error),
      ));
    } catch (error) {
      if (response.headersSent) return;
      response.writeHead(error.statusCode || 400).end(error.message);
    }
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const verifyToken = process.env.BLOOM_WHATSAPP_VERIFY_TOKEN;
  const appSecret = process.env.BLOOM_WHATSAPP_APP_SECRET;
  const port = Number(process.env.PORT || 3000);
  const server = http.createServer(createWebhookHandler({ verifyToken, appSecret }));
  server.listen(port, () => console.log(`WhatsApp webhook listening on http://localhost:${port}/webhooks/whatsapp`));
}
