# Bloom (Nightstand)

Bloom is an intentional replacement for a social feed. Captures become compact learning cards, then the local-first reader resurfaces each card on a gentle schedule. Reader state stays on the device.

Open the [production pilot](https://bloom-amber-chi.vercel.app). Use the reader key, then Settings → Capture. See [pilot instructions](docs/pilot.md) and [live verification evidence](docs/verification-2026-10-23.md).

## Development

```sh
npm ci
npm test
npm run build
```

The built static app is in `site/`. GitHub Pages publishes the public sample feed. The production MVP deploys to Vercel: WhatsApp capture through a verified webhook, a durable queue, Gemini processing, and a private card store behind a reader key. See [docs/deployment.md](docs/deployment.md).

## Ingestion foundation

Ingestion is deliberately split into three replaceable pieces:

1. **Connector** converts WhatsApp, web, email, or CLI input to a versioned capture envelope.
2. **Processor** gives the capture to an LLM and requires JSON in the card contract.
3. **Review queue** validates the result and stages a preview under `inbox/reviews/pending/`.
4. **Publisher** moves only an explicitly approved preview into `cards/*.md`, then the normal build publishes `site/feed.json`.

This keeps WhatsApp as a preferred future front door without coupling Bloom to Meta, a bot vendor, or a hosting provider. See [docs/ingestion.md](docs/ingestion.md).

## Human review

The hosted pipeline automatically publishes cards after deterministic validation. The following review workflow applies to the local CLI: generated cards do not publish directly. `process-capture` creates a pending review containing the normalized capture, card preview, and versioned review record. A person can edit the preview, then explicitly approve or reject it with `npm run review-card --`. See the checked-in SQLite WAL example and [docs/ingestion.md](docs/ingestion.md).

## WhatsApp connector

The Meta WhatsApp Cloud API webhook adapter verifies every signed request, acknowledges it before doing source work, deduplicates provider message IDs, and queues the same capture envelopes as the CLI. Shared public links are hydrated through a size-, timeout-, redirect-, DNS-, and private-address-guarded fetcher. Configure `BLOOM_WHATSAPP_VERIFY_TOKEN` and `BLOOM_WHATSAPP_APP_SECRET`, then run `npm run whatsapp`. Deployment and Meta setup details are in [docs/ingestion.md](docs/ingestion.md).

While a Meta test sender is unavailable, use the editable [fixed link list](examples/test-links.json) and `npm run test:links` to preview a hosted pipeline test. See [link testing](docs/link-testing.md) for submission, delivery verification, and its limits.
