import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import matter from "gray-matter";
import { buildFeed, validateCard, normalizeDate, countWords, SCHEMA_VERSION } from "../scripts/build-feed.mjs";

const body = (words) => Array.from({ length: words }, (_, i) => `word${i}`).join(" ");

function cardSource({ id = "2026-01-01-test", overrides = {}, bodyWords = 450 } = {}) {
  const data = {
    id,
    title: "A test card",
    source_type: "article",
    source_title: "Test Source",
    source_url: "https://example.com/a",
    author: "Test Author",
    topic_prompt: "",
    sources: [],
    created: "2026-01-01",
    tags: ["testing"],
    reading_minutes: 3,
    tldr: ["one", "two"],
    pull_quote: "A quote.",
    recall_question: "Why?",
    recall_answer: "Because.",
    ...overrides,
  };
  return matter.stringify(body(bodyWords), data);
}

async function tempCardsDir(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "nightstand-"));
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(dir, name), content);
  }
  return dir;
}

test("normalizeDate turns a JS Date (gray-matter YAML) into an ISO day string", () => {
  assert.equal(normalizeDate(new Date(Date.UTC(2026, 7, 15))), "2026-08-15");
  assert.equal(normalizeDate("2026-08-15"), "2026-08-15");
  assert.equal(normalizeDate("yesterday"), null);
  assert.equal(normalizeDate(undefined), null);
});

test("builds the repo's real cards into a valid feed", async () => {
  const feed = await buildFeed();
  assert.equal(feed.schema_version, SCHEMA_VERSION);
  assert.ok(feed.cards.length >= 2);
  for (const card of feed.cards) {
    assert.ok(card.body_html.includes("<"), `${card.id} body rendered to HTML`);
    assert.match(card.created, /^\d{4}-\d{2}-\d{2}$/);
  }
  // Newest first.
  const dates = feed.cards.map((c) => c.created);
  assert.deepEqual(dates, [...dates].sort().reverse());
});

test("a valid card passes validation", () => {
  const parsed = matter(cardSource());
  assert.deepEqual(validateCard(parsed, "2026-01-01-test.md"), []);
});

test("bare YAML dates (parsed as Date objects) still validate and sort", async () => {
  // gray-matter parses `created: 2026-01-01` (unquoted) into a JS Date.
  const raw = cardSource().replace("created: '2026-01-01'", "created: 2026-01-01");
  const parsed = matter(raw);
  assert.ok(parsed.data.created instanceof Date, "precondition: YAML date became a Date");
  assert.deepEqual(validateCard(parsed, "2026-01-01-test.md"), []);
});

test("fails naming file and violation for a missing field", async () => {
  const dir = await tempCardsDir({
    "2026-01-01-bad.md": cardSource({ id: "2026-01-01-bad", overrides: { recall_question: "" } }),
  });
  await assert.rejects(buildFeed(dir), (e) => {
    assert.match(e.message, /2026-01-01-bad\.md/);
    assert.match(e.message, /recall_question/);
    return true;
  });
});

test("fails on id/filename mismatch", async () => {
  const dir = await tempCardsDir({ "2026-01-01-other.md": cardSource() });
  await assert.rejects(buildFeed(dir), /does not match filename/);
});

test("fails on duplicate ids", async () => {
  const dir = await tempCardsDir({
    "2026-01-01-test.md": cardSource(),
    "2026-01-01-test2.md": cardSource().replace("id: 2026-01-01-test", "id: 2026-01-01-test"),
  });
  await assert.rejects(buildFeed(dir), /2026-01-01-test2\.md/);
});

test("fails on body word count out of range", async () => {
  const dir = await tempCardsDir({
    "2026-01-01-test.md": cardSource({ bodyWords: 120 }),
  });
  await assert.rejects(buildFeed(dir), /300–900 words \(got 120\)/);
});

test("fails on tldr with wrong item count", async () => {
  const dir = await tempCardsDir({
    "2026-01-01-test.md": cardSource({ overrides: { tldr: ["only one"] } }),
  });
  await assert.rejects(buildFeed(dir), /tldr.*2–4/);
});

test("topic cards require topic_prompt and 2–5 sources", async () => {
  const noSources = cardSource({
    overrides: { source_type: "topic", topic_prompt: "a topic", sources: ["https://one.example.com"] },
  });
  const dir = await tempCardsDir({ "2026-01-01-test.md": noSources });
  await assert.rejects(buildFeed(dir), /2–5 `sources`/);
});

test("link cards require source_title, source_url, author", async () => {
  const dir = await tempCardsDir({
    "2026-01-01-test.md": cardSource({ overrides: { author: "" } }),
  });
  await assert.rejects(buildFeed(dir), /link card missing `author`/);
});

test("fails on bad frontmatter", async () => {
  const dir = await tempCardsDir({
    "2026-01-01-test.md": "---\ntitle: [unclosed\n---\nbody",
  });
  await assert.rejects(buildFeed(dir), /bad frontmatter|feed build failed/);
});

test("countWords ignores markdown syntax", () => {
  assert.equal(countWords("## Heading\n\nSome **bold** words here."), 5);
});
