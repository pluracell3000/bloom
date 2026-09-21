# Ingestion boundary

## Capture envelope

Every connector emits the same versioned JSON object:

```json
{
  "schema_version": 1,
  "kind": "url",
  "channel": "whatsapp",
  "received_at": "2026-09-21T09:00:00.000Z",
  "payload": {
    "url": "https://example.com/article",
    "title": "Optional connector metadata",
    "author": "Optional connector metadata",
    "extracted_text": "Article text obtained by the connector",
    "note": "What to focus on"
  }
}
```

Kinds:

- `topic`: `payload.prompt` and optional `note`
- `url`: absolute HTTP(S) `payload.url`, optional metadata, and `extracted_text`
- `email`: `payload.subject`, `body`, optional `from`, `source_url`, and `note`

Channels include `whatsapp`, `email`, `web`, `cli`, `api`, and `other`. Channel metadata never changes card generation. A WhatsApp adapter should only authenticate the webhook, download/normalize the message, and enqueue this envelope.

## Local flow

Queue a capture from a file or stdin:

```sh
node scripts/capture.mjs capture.json
cat capture.json | node scripts/capture.mjs
```

Create the provider-neutral prompt:

```sh
node scripts/process-capture.mjs \
  --capture inbox/requests/pending/cap-....json \
  --prompt-out /tmp/bloom-prompt.txt
```

After an LLM returns the required JSON object, validate and stage it for review:

```sh
node scripts/process-capture.mjs \
  --capture inbox/requests/pending/cap-....json \
  --response /tmp/bloom-response.json
npm test && npm run build
```

Invalid output never becomes a review. Valid output is staged at `inbox/reviews/pending/review-<capture-id>/` with the normalized capture, a Markdown preview, and `review.json`. The pending request is removed only after that bundle is complete. It is not part of `cards/` or `site/feed.json` yet.

Review the Markdown, edit it if needed, then make the publication decision explicitly:

```sh
npm run review-card -- approve inbox/reviews/pending/review-cap-... --note "Ready to publish"
npm run review-card -- reject inbox/reviews/pending/review-cap-... --note "Needs a narrower explanation"
```

Approval revalidates the preview, moves the card into `cards/`, and archives the record under `inbox/reviews/approved/`. Rejection archives the capture and preview under `inbox/reviews/rejected/`. This filesystem state machine is local and replaceable; a future service can preserve the same versioned states without choosing a host now.

## Concrete end-to-end example

`examples/sqlite-wal-review/` contains a real URL capture based on SQLite's official write-ahead logging documentation and a checked-in provider response fixture. Reproduce the provider-independent slice with:

```sh
node scripts/capture.mjs examples/sqlite-wal-review/capture.json
node scripts/process-capture.mjs \
  --capture inbox/requests/pending/cap-20260921-sqlite-wal.json \
  --response examples/sqlite-wal-review/response.json
```

The result stops in `inbox/reviews/pending/` for human review. The example deliberately does not approve or publish the card.

## Optional OpenAI-compatible adapter

`process-with-llm.mjs` is a small adapter, not a provider commitment. It only runs when all three environment variables are supplied:

- `BLOOM_LLM_ENDPOINT`
- `BLOOM_LLM_MODEL`
- `BLOOM_LLM_API_KEY`

No endpoint, model, account, or paid service is configured in the repository. Secrets must stay in the deployment secret store and must never enter a capture, card, log, or commit.

## URL hydration

Core ingestion does not fetch arbitrary URLs. The connector must turn the source into `payload.extracted_text` first. This creates an explicit place to enforce timeouts, size limits, redirects, private-network blocking, paywall handling, and source attribution before any model call. A URL without extracted text stays pending and cannot reach the LLM adapter.

## Next connector: WhatsApp

A future WhatsApp connector should:

1. Verify the provider webhook signature.
2. Map text, shared links, and forwarded content to a capture envelope.
3. Acknowledge quickly and process asynchronously.
4. Keep provider message IDs only as opaque deduplication metadata.
5. Return a review preview before publishing when the workflow requires review.

The connector can be replaced without changing the card schema, reader, processing contract, or deployment target.
