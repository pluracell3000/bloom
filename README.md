# Bloom (Nightstand)

Bloom is an intentional replacement for a social feed. Captures become compact learning cards, then the local-first reader resurfaces each card on a gentle schedule. Reader state stays on the device.

## Development

```sh
npm ci
npm test
npm run build
```

The built static app is in `site/`. GitHub Pages remains the current deployment target.

## Ingestion foundation

Ingestion is deliberately split into three replaceable pieces:

1. **Connector** converts WhatsApp, web, email, or CLI input to a versioned capture envelope.
2. **Processor** gives the capture to an LLM and requires JSON in the card contract.
3. **Review queue** validates the result and stages a preview under `inbox/reviews/pending/`.
4. **Publisher** moves only an explicitly approved preview into `cards/*.md`, then the normal build publishes `site/feed.json`.

This keeps WhatsApp as a preferred future front door without coupling Bloom to Meta, a bot vendor, or a hosting provider. See [docs/ingestion.md](docs/ingestion.md).

## Human review

Generated cards never publish directly. `process-capture` creates a pending review containing the normalized capture, card preview, and versioned review record. A person can edit the preview, then explicitly approve or reject it with `npm run review-card --`. See the checked-in SQLite WAL example and [docs/ingestion.md](docs/ingestion.md).
