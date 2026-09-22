// Vercel Function: Meta WhatsApp Cloud API webhook.
// Raw-body HMAC verification happens before any parsing, then captures are
// published to the durable queue. bodyParser must stay off: the signature
// covers the exact bytes Meta sent.

import { createWebhookHandler } from "../../scripts/whatsapp-webhook.mjs";
import { publishWhatsAppPayload } from "../../scripts/lib/queue-publisher.mjs";

export const config = { api: { bodyParser: false } };

export default createWebhookHandler({
  verifyToken: process.env.BLOOM_WHATSAPP_VERIFY_TOKEN,
  appSecret: process.env.BLOOM_WHATSAPP_APP_SECRET,
  path: "/api/webhooks/whatsapp",
  awaitEnqueue: true,
  enqueue: (payload, { logger }) => publishWhatsAppPayload(payload, { logger }),
});
