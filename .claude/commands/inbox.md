---
description: Process everything open in inbox/list.md into Nightstand cards
---

# /inbox — the processing ritual

Optional input: `$ARGUMENTS` may be a pasted dump of links/topics (e.g. a WhatsApp backlog). If present, append each pasted item as a line to `inbox/list.md` **first**, then process the whole list.

## Steps

1. **Sync**: `git pull` on the current branch.
2. **Parse**: run `inbox/list.md` through `scripts/parse-list.mjs` semantics (URL lines, `topic:` lines, `| note:` / `| depth:` tails, `#` comments ignored). Show me what's open, and **flag every unparseable line** with its line number and reason — never silently drop one. Unparseable lines stay in the list unless I say otherwise.
3. **Process each entry** using the generation specs in `.claude/commands/card.md` and `PLAN.md`:
   - **link** → fetch the URL. If the fetch fails or is paywalled, ask me for pasted text or `skip`. A skip is recorded in the ledger with a reason and the line is removed from the list.
   - **topic** → run the topic research spec (web search, 2–5 real sources, evidence discipline). `depth: deeper` permits up to 900 words.
   - Honor `note:` as the angle to focus the synthesis on.
4. **Ledger**: for each processed entry append one line to `inbox/queue.jsonl`:
   `{"id":"q-NNNN","entry":"<original line>","kind":"link|topic","received_at":"<ISO now>","status":"done|skipped","card_id":"<id>","reason":"<only for skipped>"}`
   — `q-NNNN` continues the highest existing number; the file is append-only, never rewrite old lines.
5. **List**: remove each processed line from `inbox/list.md` so the list always shows exactly what's still open.
6. **Validate**: `npm test && npm run build` — both must pass.
7. **Review**: show me, per card, the title + tldr + recall question. Wait for my OK unless I told you to run unattended.
8. **Commit — exactly one commit per run**: cards + `inbox/list.md` + `inbox/queue.jsonl` together, message `inbox: <n> cards` (mention skips in the body). Push. A bad run reverts like any commit.

## Rules

- Never fabricate source content for a failed fetch.
- Never weaken `build-feed.mjs` validation to make a card pass.
- Batch questions: if several entries need my input (paywalls, too-broad topics), collect them and ask once.
