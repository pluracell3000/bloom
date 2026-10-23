# Bloom pilot verification — October 23, 2026

Production: https://bloom-amber-chi.vercel.app

Team `team_0ncaUIIa4HApcw1OQ4oUSJqq`, project
`prj_F8Fvmf4pFqI2sF1zM1u4JpyrJens`, private store `store_8NUrp91Sovye0ovC`.
The reviewed fixes were fast-forwarded onto the existing production branch
`claude/nightstand-build-plan-ofng1w`; `main` was not used.
The release preserves the existing private storage, reader authentication and
Vercel Deployment Protection. No credentials were rotated or billing changed.

## Verified live production flow

Two requests were submitted concurrently to the production `/api/capture` API
with the existing reader credential. Both returned 202 and reached the actual
Vercel Queue worker. The worker hydrated the URL, called Gemini, validated the
cards and saved them privately. Both then appeared together in `/api/feed` and
in an authenticated Chromium reader at 390 × 844.

| Input | Capture ID | Published card ID |
| --- | --- | --- |
| Topic: retrieval practice and spaced repetition | `cap-web-d6ed026c-03f8-4756-ac89-019cc5ad33ed` | `2026-10-23-1a1f90b3b3599a4735fdd60d` |
| `https://en.wikipedia.org/wiki/Spacing_effect` | `cap-web-306ba12c-2e64-424a-a50b-f0185501c06f` | `2026-10-23-1a8f5155ca4ee5eebf0ad9c2` |
| Topic submitted through the reader's Settings → Capture form: interleaving versus blocked practice | `cap-web-0529121e-fd6c-435f-8e74-6c03f6aadb1f` | `2026-10-23-8b312a0df26a3759a611b284` |

The first two worker publication logs occurred at 18:05:24 UTC on deployment
`dpl_6xHnjT8owJ9KpfhgEGeNMN2FdUTC` (commit `11c75de`). The UI capture and
browser checks ran from the explicit verifier at commit `11093f7`:
[verification build](https://vercel.com/dima-s-projects-b1e0/bloom/3zmuowB7jyqxMwLkUvbEDkmsvrgc).
These are real production captures through the authenticated fallback, not
mocked generations and not WhatsApp phone messages.

The final full verifier passed against release code `c3f6b493b717ceb8dcff0016282b0d05f58b7168`:
[passing verification build](https://vercel.com/dima-s-projects-b1e0/bloom/DSfpUGVtpPTujC7k6NsE4ZxvoBvs).
It reported `LIVE browser offline reopen PASS; no page errors`. The final
release after this record changes documentation only.

Other live checks:

- Authenticated feed: HTTP 200 with valid feed schema.
- Feed without reader key: HTTP 401.
- Capture without reader key: HTTP 401, no enqueue.
- Actual reader form submission: 202, followed by its generated card rendered
  after Refresh cards.
- Phone viewport: no horizontal overflow at 390 × 844.
- Production offline reopening: page and service-worker targets switched to
  Chromium offline mode, authenticated cached cards remained rendered, and
  “Offline — showing last synced.” appeared. Both `nightstand-v3` shell and
  private feed caches were populated; no browser page errors.
- Done → Export state → Import state: successful in the live browser, including
  checking that the selected card's reading state was present in the backup.
- A synthetic webhook with an invalid HMAC returned 401.
- A correctly signed synthetic event from a disallowed test sender returned
  200; runtime logs confirmed `WhatsApp webhook processed: 0 message(s)`.
  Sender restrictions therefore fail closed. The production sender allowlist
  is still unconfigured; this test does not establish real WhatsApp delivery.

## Gemini diagnosis and change

The configured production key listed `gemini-2.5-flash` as supporting
`generateContent` on `v1beta`, yet both the minimal unstructured request and
Bloom's exact structured request returned HTTP 404 / NOT_FOUND. This rules out
Bloom's response schema as the cause of that 404; the provider's model catalog
was insufficient evidence of an operational model route.

With the same key, `gemini-3.5-flash` answered a minimal request with 200 but
returned 503 for the structured probe. `gemini-flash-lite-latest` passed both
minimal generation and Bloom's structured generation/card validation, then the
three live captures above. Production `BLOOM_GEMINI_MODEL` was explicitly
changed to `gemini-flash-lite-latest`. No silent fallback or key rotation was
introduced. The exact upstream reason the old listed route returns 404 is not
available from the sanitized provider response.

Generation requests now have a 90-second timeout, leaving time for hydration,
validation and one repair within the 300-second worker limit. Network errors
cannot echo request credentials into logs. The diagnostic probe is opt-in and
bounded; a catalog check alone is never reported as successful generation.

## Local and simulated checks

`npm test`: 102 passing tests. `npm run build`: successful. The local build
skips the Gemini preflight because no production secrets are bound locally;
live model checks above ran with production credentials inside Vercel.

The regression tests cover a saved card followed by failed feed publication,
then retry at delivery eight: one model call, one card, no quarantine. Another
forces a stale snapshot to finish after a newer snapshot: the authoritative
feed still contains both cards. Concurrent same-title captures retain distinct
IDs. An offline-cache regression also proves that the matching reader can reopen
its cached feed without network and a different key cannot read it.
These fault injections use simulated storage; they are not production
outage experiments. Real concurrent publication was checked with the two
production captures above.

Local Chromium with simulated generation/storage passed the capture form,
reader rendering, state export/import, and offline reopening with the server
completely stopped. A persistent Chromium profile reported zero PWA
installability errors. These are browser checks, not actual phone installation.

## Reproduce and operate

See [pilot.md](pilot.md) for reader access, capture, installation, offline use,
backup/restore and remaining limitations. See [deployment.md](deployment.md)
for production configuration and [link-testing.md](link-testing.md) for signed
synthetic webhook tests with an explicitly allowlisted sender.

The opt-in live verifier is `scripts/verify-pilot.mjs --live`. It requires the
existing reader key through a secure environment binding. Without
`--capture-ids=<id>,<id>` it creates two production captures. `--browser` adds
browser checks; `--capture-ui` additionally creates one topic through the UI.
`npm run verify:pilot:browser -- --capture-ids=<id>,<id>` installs pinned browser
test dependencies under `/tmp/bloom-browser`, outside the app dependencies.
Do not add live verification or reader-key export to the normal build command.

Secure handoff used RSA-OAEP/SHA-256: only ciphertext left Vercel, and the existing
reader key was decrypted into an owner-only workspace file outside Git. No
plaintext reader key, provider key, request signature or authentication cookie
was printed in logs or committed. Move the reader key into your password
manager and enter it only in Bloom's password field.

## Remaining limitations

- Real WhatsApp remains unverified. Finish Meta's phone-number setup, configure
  the owner's sender ID in `BLOOM_WHATSAPP_ALLOWED_SENDERS`, redeploy, then send
  one real message and confirm its new card. Browser capture already works.
- iOS/Android Add to Home Screen, standalone storage behavior and OS eviction
  still need actual-device checks. Capturing and receiving new cards need
  internet; offline use is for previously downloaded cards.
- State is per-device. Export/import transfers reading state, not cards or the
  reader key. There is no automatic cross-device state sync.
- The key and cached private feed live on the trusted device. Server key rotation
  cannot revoke an offline copy. Clearing browser storage removes that copy.
- Old quarantined captures were retained, not silently replayed or deleted.
  Re-capture wanted content after correcting its cause.
- The feed compiles all private cards on each refresh. Appropriate for a small
  pilot, not a large library. The model alias can change upstream; generation
  quality and topic references still need human judgment.
