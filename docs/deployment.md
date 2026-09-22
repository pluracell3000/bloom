# Hosted deployment (Vercel, free tier)

Bloom's production MVP runs entirely on Vercel Hobby: one project, no other
cloud accounts, no servers. Cards and source content live in a **private**
Blob store; nothing private is committed to this public repo.

## Flow

```
WhatsApp message
  → Meta Cloud API webhook
  → POST /api/webhooks/whatsapp      (HMAC-verified raw body, fast 200)
  → Vercel Queues topic bloom-captures (durable, idempotent per provider message ID)
  → /api/queues/process-capture      (private consumer; one message at a time:
                                      hydrate URL → Gemini → validate → repair once
                                      → publish card + rebuild feed, else quarantine)
  → private Blob store: cards/*.md, feed.json, quarantine/*.json
  → reader (static shell + /api/feed behind the reader key)
```

The reader is the same static app as before. On the hosted deployment it
loads `/api/feed` with the reader key; on GitHub Pages or a local preview it
falls back to the static `site/feed.json` sample feed.

## Why Vercel-only

- Durable queue with retries, idempotency keys, and per-message visibility:
  Vercel Queues (beta). Hobby includes the first 1,000,000 queue API
  operations per month. <https://vercel.com/docs/queues> and
  <https://vercel.com/docs/queues/pricing>
- Durable private card storage without a second provider: Vercel Blob
  `access: "private"` stores. Hobby includes 1 GB storage, 10k simple and 2k
  advanced operations, 10 GB transfer per month.
  <https://vercel.com/docs/vercel-blob/usage-and-pricing>
- Consumer functions triggered by a queue have no public URL; only Vercel's
  queue infrastructure can invoke them. <https://vercel.com/docs/queues>
- Hobby functions run up to 300s, enough for hydrate + Gemini + validate.
  Hobby includes 1,000,000 invocations per month.
  <https://vercel.com/docs/plans/hobby>

Known free-tier constraints (accepted for this MVP):

- Hobby is personal, non-commercial use only.
- Vercel Authentication cannot protect a Hobby **production** domain, so the
  feed is gated in-app by `BLOOM_READER_KEY` instead. The static shell is
  public and contains no private data.
  <https://vercel.com/docs/deployment-protection>
- Queues is in beta. The blast radius is one consumer function; the queue can
  be swapped for another provider without touching capture or cards.
- If a Hobby allowance is ever exceeded, that capability pauses (no charges);
  Bloom's volume is orders of magnitude below every allowance.

## One-time setup

1. **Create the Vercel project.** Sign up at vercel.com (the spare Gmail),
   choose Hobby, import this repository. Keep the default branch setting.
   Vercel deploys `vercel.json` automatically; no build command is needed
   (`npm test`/`npm run build` keep running in GitHub Actions).

2. **Create the Blob store.** In the project: Storage → Create Database →
   Blob. Create it as a **private** store and connect it to the project.
   Vercel injects `BLOB_READ_WRITE_TOKEN` (production) automatically.

3. **Set environment variables.** Project → Settings → Environment Variables.
   Mark all four secrets as **Sensitive**, scoped to **Production** only:

   - `BLOOM_GEMINI_API_KEY` — from AI Studio (free tier)
   - `BLOOM_WHATSAPP_APP_SECRET` — Meta app secret
   - `BLOOM_WHATSAPP_VERIFY_TOKEN` — a random string you invent
   - `BLOOM_READER_KEY` — a random string you invent; this opens the feed

   Non-secret: `BLOOM_GEMINI_MODEL` (for example `gemini-2.5-flash`; pick
   against the project's live free-tier quota in AI Studio).

   Never scope secrets to Preview/Development, never put them in the repo,
   build args, or anything prefixed for browser exposure.

4. **Deploy.** Push to the default branch (or redeploy from the dashboard).
   The queue topic and consumer are created from `vercel.json` on deploy.

5. **Seed existing cards.** Copy `BLOB_READ_WRITE_TOKEN` from the Blob store
   settings into your shell (do not commit it) and run:

   ```sh
   BLOB_READ_WRITE_TOKEN=... node scripts/vercel-seed-blob.mjs
   ```

   This uploads `cards/*.md` privately and builds the hosted `feed.json`.

6. **Connect WhatsApp.** In the Meta app dashboard, set the callback URL to
   `https://<your-project>.vercel.app/api/webhooks/whatsapp` and the verify
   token to your `BLOOM_WHATSAPP_VERIFY_TOKEN`. Subscribe the WhatsApp
   Business Account to `messages` events.

7. **Open the reader.** Visit `https://<your-project>.vercel.app`, enter the
   reader key when asked. It is stored on that device only.

## Verify the pipeline

1. `npm test && npm run build` — 89+ tests, feed compiles.
2. After deploy: `curl https://<project>.vercel.app/api/feed` → `401`
   (gate works), and with `Authorization: Bearer <reader key>` → feed JSON.
3. Meta webhook verification: the dashboard challenge returns 200.
4. Send yourself a WhatsApp message with a link. Within a minute the card
   appears in the reader (pull to refresh). Nothing lands in Git.

## Operations

- **Quarantine.** Cards that fail validation twice, or captures that exhaust
  8 deliveries, land in `quarantine/<capture-id>.json` in the Blob store
  (visible in the Vercel dashboard Storage tab). Nothing bad ever publishes
  silently.
- **Retries.** Rate limits (Gemini 429/5xx) back off 60s between deliveries;
  the queue retries up to 8 deliveries before dropping.
- **Logs.** Runtime logs (1h retention on Hobby) are in the Vercel dashboard.
  Secret values are Sensitive and never printed by this code.
- **Gemini quota.** Free-tier RPM/TPM/RPD are project-wide and visible in AI
  Studio. If the model choice changes, update `BLOOM_GEMINI_MODEL`; no code
  change needed.

## GitHub Pages

The existing Pages workflow is untouched: it keeps publishing the public
sample feed from `cards/`. It can stay as a demo or be disabled in repo
settings. Real captured cards never enter the repo, so Pages can never leak
them.
