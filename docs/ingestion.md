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

After an LLM returns the required JSON object, validate and materialize it:

```sh
node scripts/process-capture.mjs \
  --capture inbox/requests/pending/cap-....json \
  --response /tmp/bloom-response.json
npm test && npm run build
```

Invalid output never becomes a card. A successful capture moves to `inbox/requests/processed/`.

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
