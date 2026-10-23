# Test Bloom with a fixed list of links

Use `examples/test-links.json` as an editable input list while Meta's test
sender is unavailable. The runner sends a signed, simulated text-message
event through the existing deployed WhatsApp receiver. No personal number,
Meta sender, access token, or additional public ingestion route is needed.

This exercises the hosted webhook, durable queue, real URL extraction,
Gemini generation and validation, private card storage, and private feed.
It does not verify transport from a WhatsApp phone to Meta. Open the reader
afterward to check the resulting cards and reading experience.

## Preview the list

```sh
npm run test:links
```

This is a dry run. It submits nothing and needs no credentials. Each entry
can be a URL string or an object with `url` and an optional `note`.

## Run against the hosted pipeline

Production must have the Gemini key/model, connected private Blob store,
WhatsApp app secret/verify token, and reader key configured as described in
[deployment.md](deployment.md). Redeploy after changing environment variables.
The private feed must respond successfully before the runner submits any
links. A configured, authenticated feed that reports it has not yet been
seeded is also accepted: the first successful capture creates its feed.

Provide `BLOOM_WHATSAPP_APP_SECRET` and `BLOOM_READER_KEY` to the local process
through your secret manager or a permission-restricted, ignored environment
file. Never paste their values into command arguments or commit them.
With those variables loaded:

```sh
npm run test:links -- \
  --base-url https://bloom-amber-chi.vercel.app \
  --run-id links-20261023 \
  --send
```

The runner waits up to three minutes for new cards with the listed source
URLs. A webhook acknowledgment alone is not a passing result; old cards do
not count. The runner prints only source URLs, card titles, and progress.
Open the production reader and refresh its feed to inspect the cards.

Reusing the same run ID and unchanged entries produces the same provider
message IDs, so the queue can deduplicate accidental resends within its
seven-day retention period. Use a new run ID only when you intend another
generation. A resend after an already completed test will not create new
cards and therefore cannot pass the new-delivery check.

If delivery is incomplete, check the Vercel queue logs and private Blob
`quarantine/` records. Source extraction, model quota, validation, and
publishing failures still apply. Do not repeatedly submit a new run ID to
work around a failed batch; resolve its failure first.

The automated local integration test uses the real webhook/parser/publisher
and worker with a fixture model response and in-memory storage. It verifies
the wiring without claiming a live Gemini or Vercel test passed.
