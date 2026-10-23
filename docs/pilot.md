# Bloom pilot operations

## Open and capture

Production: https://bloom-amber-chi.vercel.app

Vercel deployment protection and the Bloom reader key are separate gates. Sign in
with the authorized Vercel account when required. Obtain BLOOM_READER_KEY from the
owner's password manager; never put it in a URL, issue, screenshot, or Git. Vercel
sensitive values cannot be recovered through the environment API. If the original
key was not retained, arrange a deliberate replacement through a secure secret
handoff (all devices will need the new key).

Unlock the reader, open Settings, enter one HTTP(S) link or a topic, and press
Capture. Keep the returned capture ID for troubleshooting. Queued means accepted,
not generated. Wait a few minutes, then Refresh cards. Capture requires internet;
text is not automatically queued offline. The browser fallback uses the same
queue, hydration, Gemini, validation, and private storage pipeline as WhatsApp.

## Phone and offline

On iPhone open in Safari, Share → Add to Home Screen. On Android use Chrome's
Install app/Add to Home screen action. Open the installed app online and unlock
it there (its storage may differ from the browser tab). Wait for cards to load,
then reopen once online so the service worker controls it. Previously fetched
cards and reading state can then reopen offline. Newly captured cards need a
network refresh. Actual iOS/Android installation and storage eviction behavior
require a real-device check; a manifest alone is not proof of installation.

Settings → Export state downloads a JSON backup. Transfer it privately to another
device and use Import state. This transfers reading/review state, not cards or the
reader key. There is no automatic cross-device state sync. Private card data and
the reader key remain in browser storage for offline use; use a trusted device.
Clearing browser data removes these copies. Server key rotation cannot revoke a
copy on a device that remains offline.

## Production setup

Project bloom (prj_F8Fvmf4pFqI2sF1zM1u4JpyrJens), team dima-s-projects-b1e0
(team_0ncaUIIa4HApcw1OQ4oUSJqq). Production branch is
claude/nightstand-build-plan-ofng1w. Confirm current branch and deployment SHA
before deploying; do not assume main.

Required: BLOOM_GEMINI_API_KEY, BLOOM_GEMINI_MODEL, BLOOM_READER_KEY,
BLOB_READ_WRITE_TOKEN. WhatsApp also requires BLOOM_WHATSAPP_APP_SECRET,
BLOOM_WHATSAPP_VERIFY_TOKEN and BLOOM_WHATSAPP_ALLOWED_SENDERS (comma-separated
Meta sender IDs, digits with country code, no '+'). An empty allowlist accepts no
WhatsApp captures. Signature verification establishes Meta authenticity, not that
a sender is the owner. Configure the actual owner's sender explicitly.

Storage stays private in store_8NUrp91Sovye0ovC. Feed requests authenticate before
reading immutable cards. The feed is rebuilt on read, so a stale shared snapshot
cannot lose concurrent updates. This is a small pilot design: reading all cards
per refresh becomes expensive for large libraries. A saved card is a commit
record keyed by capture identity; queue redelivery reuses it without another
model call. Distinct captures with identical titles remain distinct cards.

## Gemini and failed captures

Verified production model: `gemini-flash-lite-latest`. On October 23 the old
`gemini-2.5-flash` listed in the catalog but both minimal and structured
requests returned 404. The replacement passed generation and card validation
with the same key. The alias can change upstream; rerun the probe after failures.

Run `npm run check:gemini` in a secure environment with the production key and
model. Deployment builds also run this preflight when configured. It lists only
model names supporting generateContent and checks the exact configured model
against the key's v1beta model catalog. It never prints keys or provider response
bodies and does not rotate credentials or silently choose another model.
Use `npm run check:gemini -- --probe --models=<catalog-model>` to test actual
minimal and structured generation; this explicitly makes model API calls.
Requests are bounded so a hung model cannot consume the entire worker lifetime.

For 404 NOT_FOUND, compare the configured model with this catalog before changing
it. Check the exact endpoint in scripts/lib/gemini.mjs. For 401/403 inspect API key
restrictions/service access; for 429 inspect quota. Credentials being configured
does not prove they work. The preflight proves model availability, not successful
card generation. A controlled capture is still required after deployment.

Use recent runtime logs (Hobby retention is one hour), filter by capture ID.
Quarantined captures stay under the private quarantine/ prefix. Correct the
cause before resubmitting; a new browser submission gets a new capture ID.
Do not treat a 202 response or an exhausted retry as generation success.

## Verification checklist

1. Unauthorized feed/capture calls must return 401; no key in URLs or logs.
2. Submit one topic and one public article, record IDs, then find their generated
   cards in the authenticated feed and the rendered reader.
3. Distinguish signed synthetic webhook events from actual WhatsApp messages.
   Do not claim WhatsApp success without an actual message from an allowed sender.
4. Check phone-width overflow, recall/Done, export/import, install, online warmup,
   and offline reopening. Keep mocked tests separate from live evidence.
5. `npm test` includes capture auth, retry after a saved-card/feed-write failure,
   concurrent identical titles, sender filtering, reader rendering, and state
   round-trip tests. `npm run build` validates the sample feed plus configured
   model availability. Neither establishes the live end-to-end flow.
