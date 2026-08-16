---
description: Generate one Nightstand card from a URL, pasted text, or a topic prompt
---

# /card — generate a single Nightstand card

Input: `$ARGUMENTS` — one of:
- a URL (article, newsletter, podcast page, video page, book review/notes)
- pasted text (a transcript, an excerpt, a full article body — treat it as the source)
- `topic: <prompt>` — a commissioned topic card

Optional tail on any input: `| note: <what to focus on>` and/or `| depth: deeper` (topic cards only; permits up to 900 words).

Read `PLAN.md` (Card schema + generation specs) before generating. The card file goes in `cards/<id>.md` where `id` is `YYYY-MM-DD-<short-slug>` (today's date, kebab-case slug, must match the filename).

## Shared rules (both card kinds)

- **Synthesis, not summary.** Re-teach the core argument so it sticks. 400–700 words (up to 900 only with `depth: deeper`).
- Body structure: one-sentence central claim → mechanism/reasoning in 2–4 short sections (`##` headings) → one closing "so what" that goes beyond the source.
- Style: first-principles, concrete numbers and examples, no throat-clearing, no "in this article".
- `tldr`: 2–4 lines, each a standalone takeaway.
- `recall_question`: tests the *mechanism* (why/how), never trivia or dates-for-dates'-sake.
- `recall_answer`: ≤ 2 sentences.
- `reading_minutes = ceil(word_count / 180)`.
- Frontmatter must satisfy the build validator — run `npm run build` after writing the card; fix anything it flags.

## Link cards (URL or pasted text)

Role: you are re-teaching this to the person who just consumed it, so it sticks. They already saw it once — do not recap chronologically. Extract the *argument*: the 1–3 ideas that would be a real loss to forget.

- URL input: fetch the page. If the fetch fails or hits a paywall, say so and ask for pasted text or `skip` — never fabricate the content.
- Pasted-text input: ask for (or infer from the paste) `source_title`, `source_url`, `author`; if the URL is genuinely unknown ask rather than inventing one.
- `source_type`: pick the closest of `article | newsletter | podcast | video | book`.
- `pull_quote`: one near-verbatim quote from the source — the line you'd underline.

## Topic cards (`topic: ...`)

Research-grade, not from memory alone:

1. **Research first**: web-search across multiple independent sources; read enough to identify the 2–4 load-bearing ideas, not a timeline of everything. Record the 2–5 sources actually relied on in `sources`.
2. **Evidence discipline**: never combine figures from different sources into one number; anything contested is either attributed ("estimates range…") or cut; prefer mechanisms and turning points over date lists.
3. `pull_quote` becomes one striking, *sourced* fact.
4. If the topic is too broad for 700 words, propose a split into 2–3 cards and **ask before generating**.
5. `source_type: topic`, `topic_prompt` verbatim from the input, `source_title`/`source_url`/`author` empty.

## Finish

1. Write `cards/<id>.md`.
2. `npm run build` — must pass; fix violations, never weaken the validator.
3. Show me the tldr + recall question for review.
4. On my OK (or if I said to proceed unattended): commit as `card: <id>` and push.
