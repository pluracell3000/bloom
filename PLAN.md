# Nightstand — Build Plan from an Empty Repo (v4.2)

Execute this spec starting from an empty repository. It defines the product, the binding design/engineering constraints, and the phases with acceptance criteria. Do not move past a phase until its criteria pass. Where this plan constrains choices, the plan wins over habit.

The app is called **Nightstand**. Repo name: `nightstand`. Branch: `main` from the first commit.

---

## Implementation notes (lessons already learned — apply, don't rediscover)

1. **Stack:** Node 22+, `"type": "module"`, no framework, no bundler. Dependencies: `gray-matter`, `marked` only. Dev: `jsdom` for the smoke test. npm scripts: `test` = `node --test tests/*.mjs`, `build` = `node scripts/build-feed.mjs`.
2. **YAML gotcha:** gray-matter parses `created: 2026-08-15` into a JS Date. Normalize to an ISO `YYYY-MM-DD` string in the builder before sorting, or newest-first ordering silently breaks.
3. **Fonts:** fetch the variable TTFs from the google/fonts repo raw paths (`ofl/literata/Literata%5Bopsz%2Cwght%5D.ttf`, `ofl/fraunces/Fraunces%5BSOFT%2CWONK%2Copsz%2Cwght%5D.ttf`), subset with `pyftsubset --unicodes="U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+20AC,U+2122,U+2726" --layout-features='*' --flavor=woff2` (~280KB total), commit the woff2 files plus each font's OFL.txt into `site/fonts/`. Include U+2726 (✦) — the horizon mark uses it. Fallback stacks: body `"Literata", ui-serif, "Iowan Old Style", Georgia, serif`; display `"Fraunces", ui-serif, Georgia, serif`.
4. **Icons:** generate 180/192/512 PNGs at build-setup time (e.g. sharp from an SVG: paper background, moss horizon line, serif N). `apple-touch-icon` must be PNG.
5. **Smoke test:** boot the real `app.js` in jsdom against the real built `feed.json`; stub `fetch`, define `navigator` via `Object.defineProperty` (it is getter-only on globalThis in Node 22), stub `matchMedia` to reduced-motion so transitions are instant. Assert: both zones render, opening a card shows the recall question, Done removes it from Zone A and persists state to localStorage.
6. **Service worker + GitHub Pages subpath:** register with a relative `sw.js` and keep every SHELL path relative so the app works under `/<repo>/`.
7. **Sample cards:** ship two (one link, one topic) so the feed is never empty on first install and the build validator is exercised from day one.
8. **Commit style:** small commits per phase; `card: <slug>` and `inbox: <n> cards` for content.

---

## Product decisions (already made — do not relitigate)

1. **Synthesis, not summary.** Each card re-teaches the core argument, ~400–700 words.
2. **Two card origins, one format.** `link` cards synthesize a specific source I consumed or captured. `topic` cards are commissioned: I write a prompt ("history of the Czech Republic in the 20th century"), the pipeline researches and writes it. Both share the same schema, length, and recall mechanics.
3. **Two-zone feed.** Zone A ("Fresh") = unread, newest first, ending in an explicit "caught up" marker. Zone B ("Worth a second look") = resurfaced cards below the line. Zone B never shows counts, badges, or overdue framing.
4. **One recall question per card**, answer behind a tap. Engaging is optional.
5. **Gentle spaced resurfacing:** +3, +14, +45 days after first read, question-first, then retire.
6. **Sparse volume.** Capture is cheap; generation is deliberate.
7. **No images in v1.** One pull-quote (link cards) or one striking fact (topic cards) instead.
8. **Zero-infrastructure ingestion for v1.** The dropbox is a text file in the repo, editable from my phone. No bots, no workers, no cron, no webhooks. Messaging-app capture (Telegram/email/WhatsApp) is parked — research findings preserved in the parking lot so v2 doesn't start over.
9. **Capture is instant; generation is reviewed.** Cards are generated in Claude Code sessions with me in the loop. The app is a static renderer: no API keys, no runtime backend, no accounts.
10. **Local-first, git-based.** The list, the ledger, the cards, and the site all live in this repo. Reading state lives on-device with export/import.
11. **Engagement means "opening it feels good," not addiction mechanics.** Banned: streaks, badges, unread counts, notifications, infinite-scroll tricks.

## Engines and the credential boundary

- **Claude Code (Bedrock) = the processor.** It has authenticated git, the repo, and the commands. All card generation and commits happen here via `/inbox` and `/card`.
- **Claude app (mobile/web) = capture-adjacent and ad-hoc.** It can fetch the raw list from a public repo, do topic research, and draft a full card on the go — but it holds no git credentials, so its output is a ready card file/text to hand to the repo, never a direct commit. A scheduled daily task in the Claude app can pre-draft cards from the list; committing remains a Claude Code step. Do not work around this boundary by storing tokens in chats, memory, or the repo.
- **Repo visibility:** unauthenticated raw reads (for the Claude app) require the repo to be public. If the repo stays private, the Claude app path degrades to paste-in/paste-out; Claude Code is unaffected. Decide at Phase 0; default: private repo, Claude Code as sole automated reader.

## Non-goals for v1 (parking lot, with research already done)

- **Telegram bot dropbox** — the v2 capture upgrade if list-editing friction hurts. Findings: free via BotFather; DM the bot; unconfirmed updates kept only 24h, so drain via GitHub Actions cron (~4h) + drain-on-demand; hard-allowlist my user id; "✓ queued" reply.
- **Email dropbox** — the newsletter channel. Findings: Cloudflare Email Routing → Email Worker → commit to repo; free; needs a domain on Cloudflare; kills the paywall problem because subscriber emails ARE the content. Fallback: dedicated Gmail + IMAP poll.
- **WhatsApp** — only if a business phone number ever materializes. Findings: Cloud API needs a Meta Business account + dedicated business number + webhook infra; unofficial bridges are ban-prone. Backlog from the existing self-group migrates via paste into `/inbox` (supported in v1).
- **Fully automated generation** (list change → CI generates cards): only after the prompt is proven over ~20 reviewed cards.
- Generated images/infographics — v2. Push notifications — never. Multi-device state sync — export/import is enough. Native iOS app — no. Graded SRS — no.

---

## Ingestion architecture (binding)

**The dropbox is `inbox/list.md`** — a human-editable file, one entry per line, edited from the GitHub mobile app / web editor / any git client in seconds:

```
https://stratechery.com/2026/some-article/
https://example.com/podcast-episode  | note: the part about pricing power
topic: history of the Czech Republic in the 20th century
topic: how does ASML's EUV light source actually work | depth: deeper
```

Rules: a line is either a URL or `topic: <prompt>`; an optional `| note:` / `| depth:` tail. Anything unparseable is surfaced to me at processing time, never silently dropped.

**The ledger is `inbox/queue.jsonl`** — processing history, append-only:

```json
{"id":"q-0042","entry":"topic: history of the Czech Republic in the 20th century","kind":"topic","received_at":"ISO","status":"done","card_id":"2026-08-20-czech-20th-century"}
```

`status`: `pending` → `done` | `skipped` (with reason). `/inbox` moves entries from list to ledger: after processing, the line is removed from `list.md` and recorded in the ledger, so the list always shows exactly what's still open and history is never lost. A bad run reverts like any commit.

---

## Design system (binding for Phase 2)

**Concept: "Nightstand edition."** A privately printed journal of ideas you chose to keep — closer to a well-set book than to an app. Every structural device must encode meaning, not decorate.

**Palette (light / dark, dark follows `prefers-color-scheme`):**

| Token        | Light      | Dark       | Use |
|--------------|-----------|------------|-----|
| `--paper`    | `#F6F4EF` | `#12130F`  | background |
| `--ink`      | `#1C1B18` | `#E8E4DA`  | body text |
| `--ink-soft` | `#6E6A60` | `#9B968A`  | metadata, captions |
| `--rule`     | `#DDD8CC` | `#2A2B25`  | hairlines, dividers |
| `--moss`     | `#3E5C48` | `#7FA98C`  | THE accent — reserved exclusively for memory actions: Reveal, Done, the caught-up mark, Zone B header |
| `--quote`    | `#8A5A2B` | `#C89B6A`  | pull-quotes only |

Accent discipline is a rule: moss appears **only** where memory is involved, so color itself teaches the app's semantics. Never for links, focus rings, or chrome. Avoid the generic AI-design defaults (cream + terracotta serif; near-black + acid green; broadsheet hairline grid).

**Type (three roles, self-hosted woff2, subsetted, committed so offline works):**
- **Body: Literata** (variable) — designed for long-form screen reading; 18–19px, line-height 1.6, measure 60–68ch, `text-wrap: pretty`.
- **Display: Fraunces** (variable, high optical size) — card titles and recall questions only.
- **UI/metadata: system stack** — chrome, timestamps, source labels.

**Signature element: the horizon line.** The "caught up" divider: a thin rule, a small mark (`✦ Caught up`) in moss — below it the page shifts to a slightly dusked background where Zone B lives, question-first. The boundary is felt, not labeled. Spend the boldness here; keep everything else quiet.

**Motion (one orchestrated moment, everything else subtle):**
- Card expand/collapse: container transform ~250ms, gentle spring (View Transitions API where supported, CSS fallback).
- **Reveal** (the orchestrated moment): the answer un-blurs and fades in like ink settling, ~400ms.
- "Done": a small moss check draws itself (~300ms), the card settles out of Zone A.
- All motion respects `prefers-reduced-motion`.

**Copy rules:** sentence case, plain verbs, zero gamified language. Buttons: "Reveal", "Done", "Open card". Empty Zone A opens on the horizon line — the empty state IS the reward state. Empty Zone B: "Nothing to revisit today." Errors say what happened and what to do next.

---

## Mobile-first requirements (binding, Phase 2 acceptance depends on these)

Used ~95% on an iPhone from the home screen. Build for that first; desktop must merely not break.

1. Layout in `dvh`/`svh`, never `100vh`. Respect `env(safe-area-inset-*)` everywhere (`viewport-fit=cover`).
2. Tap targets ≥ 44×44pt. Primary actions (Reveal, Done) in the lower half of the card — thumb zone.
3. No hover-dependent affordances. `-webkit-tap-highlight-color: transparent` plus explicit `:active` pressed states (~0.97 scale).
4. `overscroll-behavior-y: contain`; momentum scrolling; no scroll hijacking, no scroll-snap.
5. Typography in `rem` so iOS text-size settings are honored; nothing below 13px equivalent.
6. Standalone PWA correctness: `display: standalone`, `apple-touch-icon`, `theme-color` both schemes, correct status bar, splash matching `--paper`, no white flash in dark mode.
7. Performance budget (hard): first meaningful render < 1s on mid LTE; total JS ≤ 50KB gzipped (no framework); fonts subsetted + preloaded; card bodies lazy-rendered past ~30 cards.
8. Fully offline after first load (shell + last feed + fonts).

---

## Robustness requirements (binding)

**Data integrity:**
- `feed.json` carries `schema_version`; the app refuses unknown versions with a clear message.
- Device state carries `state_version` + a pure `migrate(old) → new` function; every future change ships a migration.
- State dual-written to **localStorage and IndexedDB**; on boot, reconcile by most-recent write. Corrupt state is quarantined to a backup key — never silently overwritten — and the app boots with "state was reset — import a backup?".
- Export = share-sheet a timestamped JSON; Import validates before applying. This is disaster recovery — it must always work.
- List + ledger live in git; every processing run is one revertable commit.

**Scheduling correctness:**
- Due dates use *local-midnight day boundaries*, not raw 24h intervals. All schedule logic in one pure module, `scheduler.mjs`, unit-tested: interval progression, day-boundary edges, DST, retirement.

**Build & CI:**
- `build-feed.mjs` validates every card and fails loudly, naming file and violation: missing fields, duplicate ids, word counts, bad frontmatter, topic cards missing `sources`.
- CI on every push: card validation, scheduler + migration + list-parser tests, feed output sanity. Deploy only on green.

**Service worker lifecycle:**
- Versioned caches; shell cache-first; `feed.json` network-first with cache fallback and a quiet "offline — showing last synced" note.
- New SW activates on next launch (skipWaiting + clients.claim); old caches pruned; a stale shell never outlives a deploy by more than one open.

---

## Repository layout

```
nightstand/
├── cards/                    # one .md per card (the content database)
├── inbox/
│   ├── list.md               # THE dropbox: URLs and topics, hand-edited
│   └── queue.jsonl           # append-only processing ledger
├── scripts/
│   ├── build-feed.mjs        # compiles + validates cards/ → site/feed.json
│   └── parse-list.mjs        # list.md → structured entries (unit-tested)
├── site/
│   ├── index.html
│   ├── app.js
│   ├── scheduler.mjs         # pure due-date logic (unit-tested)
│   ├── state.mjs             # dual storage, migrations, export/import
│   ├── style.css             # token system from Design section
│   ├── fonts/                # subsetted woff2: Literata, Fraunces
│   ├── sw.js
│   ├── manifest.webmanifest
│   └── feed.json             # generated — never hand-edit
├── tests/
├── .claude/commands/
│   ├── card.md               # /card — one item: URL, pasted text, or topic
│   └── inbox.md              # /inbox — process everything open in list.md
├── .github/workflows/deploy.yml
└── PLAN.md                   # this file
```

---

## Card schema

```yaml
---
id: 2026-08-20-czech-20th-century      # slug, matches filename, unique
title: "One country, four regimes: the Czech 20th century"
source_type: topic                      # article | newsletter | podcast | video | book | topic
source_title: ""                        # required unless topic
source_url: ""                          # required unless topic
author: ""                              # required unless topic
topic_prompt: "history of the Czech Republic in the 20th century"   # topic cards only
sources:                                # topic cards only: 2–5 references actually used
  - https://...
  - https://...
created: 2026-08-20
tags: [history, central-europe]
reading_minutes: 5
tldr:
  - "..."
  - "..."
pull_quote: "..."                       # link cards: near-verbatim; topic cards: one striking, sourced fact
recall_question: "..."
recall_answer: "..."
---

(body: the 400–700 word synthesis, markdown)
```

Validation (build hard-fails): `tldr` 2–4 items; body 300–900 words; question/answer non-empty; unique `id`; link cards require `source_title/url/author`; topic cards require `topic_prompt` + 2–5 `sources`.

---

## Phase 0 — Scaffold (one session)

Repo layout above. Node 20+, no framework, no bundler. `build-feed.mjs` may use `gray-matter` + `marked`; nothing else. Two hand-written sample cards (one link, one topic). `parse-list.mjs` with tests for URL lines, topic lines, note/depth tails, and garbage lines. Decide repo visibility (default private).

**Accept:** build produces valid `feed.json` (with `schema_version`) from both cards; an invalid card fails naming file + violation; the list parser round-trips the example list; `npm test` runs.

## Phase 1 — Generation: `/card` and `/inbox` (one to two sessions)

The generation prompts matter more than any code in this repo.

**`/card <URL | pasted text | topic: ...>`** — single item, using the matching spec below.

**`/inbox`** — the processing ritual:
1. `git pull`; parse `inbox/list.md`; show me what's open (and flag unparseable lines).
2. Also accept a **pasted dump of links** (the WhatsApp backlog bridge) — appended as entries first.
3. Per entry: **link** → fetch; if fetch fails or paywalled, ask for pasted text or `skip`. **topic** → run the research spec. Generate the card, remove the line from `list.md`, append the ledger record. One commit per run: cards + list + ledger together.

**Link-card generation spec:**
- Role: "You are re-teaching this to the person who just consumed it, so it sticks. They already saw it once — do not recap chronologically. Extract the *argument*: the 1–3 ideas that would be a real loss to forget."
- Body: one-sentence central claim → mechanism/reasoning in 2–4 short sections → one closing "so what" beyond the source.
- Style: first-principles, concrete numbers/examples from the source, no throat-clearing.
- Plus: 2–4 line `tldr`; one near-verbatim `pull_quote`; one `recall_question` testing the *mechanism* (why/how), never trivia; `recall_answer` ≤ 2 sentences.
- Hard limits: body 400–700 words; `reading_minutes = ceil(words/180)`.

**Topic-card generation spec (research-grade):**
- Research first: web search across multiple independent sources; read enough to identify the 2–4 load-bearing ideas, not a timeline of everything. Record the 2–5 sources actually relied on in `sources`.
- Evidence discipline: no figure or claim combined across different sources into one number; anything contested is either attributed ("estimates range…") or cut; prefer mechanisms and turning points over date lists.
- Body: same structure as link cards — central claim ("the Czech 20th century is a study in how small nations survive between empires"), then the mechanism/arc, then the "so what".
- `pull_quote` becomes one striking, sourced fact. Same recall rules; same hard limits. `depth: deeper` in the entry permits up to 900 words.
- If the topic is too broad for 700 words, propose a split into 2–3 cards and ask before generating.

**Accept:** one real article, one pasted transcript, and the Czech-history topic each yield valid committed cards; the topic card's claims trace to its listed sources; a pasted three-link dump processes; human effort ≤ ~30s per link card, ≤ ~2 min review per topic card.

## Phase 2 — The PWA renderer (2 sessions: build, then polish)

Vanilla HTML/CSS/JS implementing the **Design system** and **Mobile-first requirements** exactly — those sections are the spec; reread them first.

**Session 2a — structure & behavior:**
- Feed: Zone A previews (title in Fraunces, source · minutes in system sans — topic cards show "Commissioned · N min" — tldr in Literata) → horizon line → Zone B (dusked tint, question-first: Fraunces question, "Reveal", then "Open card").
- Card expands inline; expanded card ends with the recall question + Reveal. Topic cards list their sources in small `--ink-soft` type at the end.
- One action per card: **Done** (Zone A: marks read, schedule starts; Zone B: records review, advances interval; after +45d review, retires). No like/save/share.
- `state.mjs` (dual-store, migrations, export/import via share sheet) and `scheduler.mjs` per Robustness.
- Settings sheet: Export state, Import state. Nothing else.

**Session 2b — polish pass:** run in a mobile viewport, screenshot every state (Zone A with cards, caught-up/empty, Zone B question, revealed answer, expanded link card, expanded topic card, offline, corrupt-state recovery), critique against the Design system — spacing rhythm, type scale, both schemes, motion timing, pressed states — and fix anything templated or cramped. Bar: a stranger seeing a screenshot thinks "custom-built reader," not "Bootstrap demo."

**Accept (on an actual iPhone, installed to home screen):**
- Full-screen open with correct splash/status bar in light and dark; no white flash; safe areas respected incl. landscape.
- Offline open shows last-synced feed with the quiet note.
- Zones render from seeded state; Done transitions animate; Reveal feels deliberate; reduced-motion honored.
- Export → wipe Safari data → Import restores state exactly.
- Lighthouse mobile: Performance ≥ 95, Accessibility ≥ 95; JS budget met.

## Phase 3 — Deploy (short session)

GitHub Actions on push to `main`: tests → card validation → build → deploy `site/` to GitHub Pages (Cloudflare Pages fallback). HTTPS required for the SW — both free.

**Go-live steps:** create the repo and push (`gh repo create nightstand --private --source=. --push`, or add the remote manually); enable Pages with Actions as source (`gh api repos/{owner}/nightstand/pages -f build_type=workflow`); wait for the workflow; report the live URL. If Pages rejects a private repo on the current plan, say so and switch to Cloudflare Pages (build `npm ci && npm test && node scripts/build-feed.mjs`, output dir `site`) rather than making the repo public without asking. Then: iPhone Safari → Share → Add to Home Screen; bookmark `github.com/<owner>/nightstand/edit/main/inbox/list.md` to the home screen as the capture button.

**Accept:** edit `list.md` from the phone → `/inbox` in the next Claude Code session → push → cards on the phone; a failing card or test blocks deploy.

## Phase 4 — Live with it (no code, 2 weeks)

Only then touch the parking lot. Signals:
- Skipping recall questions? → they're trivia; fix the generation prompt, not the app.
- Zone B unpleasant? → intervals too aggressive; try [7, 30].
- Capture rate dropping because editing `list.md` on the phone is annoying? → that's the trigger to un-park the **Telegram bot** (findings preserved above), not to abandon the habit.
- Topic cards feel shallow or listy? → tighten the research spec (fewer ideas, more mechanism), not longer cards.
- Entries piling up unprocessed? → generation friction; consider the parked CI automation, keeping a review step.
- Not opening the app? → design problem; revisit Session 2b before adding features.

---

## Definition of done (v1)

See a link or think of a question anywhere → add one line to `list.md` from my phone in ~20 seconds. Next Claude Code session: `/inbox`, review drafts, push — cards appear in a feed that opens instantly, works offline, and reads like a privately printed journal. Commissioned topics arrive as researched, source-listed cards in the same stream. The only "study" surface is one optional question per card plus a quiet second-look zone beneath the horizon line.
