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
3. **Publisher** validates the result with the existing card validator, writes `cards/*.md`, and lets the normal build publish `site/feed.json`.

This keeps WhatsApp as a preferred future front door without coupling Bloom to Meta, a bot vendor, or a hosting provider. See [docs/ingestion.md](docs/ingestion.md).
