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

## Gemini processing and publication

The MVP processor calls Gemini's `generateContent` API with JSON response mode and a response schema, then runs the returned object through Bloom's deterministic card validator. Invalid or blocked output never reaches the feed.

Required runtime configuration:

- `BLOOM_GEMINI_API_KEY`
- `BLOOM_GEMINI_MODEL` (for example, a current Flash model selected for the project's live quota)
- `BLOOM_PUBLICATION_MODE` (`auto`, the normal MVP path, or `review` for an explicit exception)

Run one pending capture with `npm run process -- inbox/requests/pending/cap-....json`. The default publication mode is `auto`: a schema-valid card is written atomically to `cards/`, while any validation failure leaves the capture pending. Set `BLOOM_PUBLICATION_MODE=review` to retain the human-review state machine described above.

The API key is sent in the `x-goog-api-key` header, never the URL, and must stay in the deployment secret store. Secrets must never enter a capture, card, log, or commit.

## URL hydration

Core ingestion does not fetch arbitrary URLs. The connector must turn the source into `payload.extracted_text` first. This creates an explicit place to enforce timeouts, size limits, redirects, private-network blocking, paywall handling, and source attribution before any model call. A URL without extracted text stays pending and cannot reach the LLM adapter.

## WhatsApp Cloud API connector

`scripts/whatsapp-webhook.mjs` implements the Meta WhatsApp Cloud API webhook boundary. It:

1. Answers Meta's `GET /webhooks/whatsapp` verification challenge using a constant-time token comparison.
2. Verifies `X-Hub-Signature-256` against the exact raw POST body before parsing it.
3. Acknowledges valid events immediately, then queues their work asynchronously.
4. Derives a stable, opaque capture ID from each provider message ID; atomic queue writes make webhook retries harmless.
5. Maps `/topic …` and ordinary text to topic captures, and messages containing an HTTP(S) link to URL captures with the remaining text as the requested angle.
6. Hydrates shared links through a fetcher that limits response size, duration, redirects, content types, and ports; resolves every redirect hop and rejects local, private, link-local, reserved, or mixed public/private DNS answers. The validated address is pinned for the actual request to resist DNS rebinding.

Required runtime configuration:

```sh
BLOOM_WHATSAPP_VERIFY_TOKEN=<random webhook verification token>
BLOOM_WHATSAPP_APP_SECRET=<Meta app secret>
PORT=3000 # optional
npm run whatsapp
```

Expose the service over HTTPS and configure Meta's callback URL as `https://<host>/webhooks/whatsapp`. Subscribe the WhatsApp Business Account to message events. Keep both values in the hosting platform's secret store; they must never enter Git, logs, captures, or cards.

The process needs a persistent writable checkout because accepted events are stored under `inbox/requests/pending/`. A URL whose extraction fails is still queued without `extracted_text`; the existing processor will refuse to send it to an LLM until an operator or retry worker hydrates it. Media messages are deliberately ignored for now. The webhook only captures inputs. A separate worker runs Gemini processing; valid cards publish automatically by default, while `BLOOM_PUBLICATION_MODE=review` keeps the exception path available.
