import test from "node:test";
import assert from "node:assert/strict";
import { parseList, parseLine, formatEntry } from "../scripts/parse-list.mjs";

test("parses a plain URL line", () => {
  const { entries, unparseable } = parseList("https://stratechery.com/2026/some-article/");
  assert.equal(unparseable.length, 0);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].kind, "link");
  assert.equal(entries[0].url, "https://stratechery.com/2026/some-article/");
});

test("parses a URL with a note tail", () => {
  const { entries } = parseList("https://example.com/podcast-episode  | note: the part about pricing power");
  assert.equal(entries[0].kind, "link");
  assert.equal(entries[0].url, "https://example.com/podcast-episode");
  assert.equal(entries[0].note, "the part about pricing power");
});

test("parses a topic line", () => {
  const { entries } = parseList("topic: history of the Czech Republic in the 20th century");
  assert.equal(entries[0].kind, "topic");
  assert.equal(entries[0].prompt, "history of the Czech Republic in the 20th century");
});

test("parses a topic line with a depth tail", () => {
  const { entries } = parseList("topic: how does ASML's EUV light source actually work | depth: deeper");
  assert.equal(entries[0].kind, "topic");
  assert.equal(entries[0].prompt, "how does ASML's EUV light source actually work");
  assert.equal(entries[0].depth, "deeper");
});

test("parses note and depth together", () => {
  const { entries } = parseList("topic: x | note: hello | depth: deeper");
  assert.equal(entries[0].note, "hello");
  assert.equal(entries[0].depth, "deeper");
});

test("surfaces garbage lines instead of dropping them", () => {
  const text = [
    "https://ok.example.com/a",
    "just some words that are not a url",
    "topic:",
    "ftp://not-http.example.com/x",
    "https://ok.example.com/b | banana: nope",
  ].join("\n");
  const { entries, unparseable } = parseList(text);
  assert.equal(entries.length, 1);
  assert.equal(unparseable.length, 4);
  assert.equal(unparseable[0].line, 2);
  assert.match(unparseable[1].reason, /empty prompt/);
  assert.match(unparseable[3].reason, /unrecognized tail/);
});

test("ignores blank lines and comments", () => {
  const { entries, unparseable } = parseList("# a comment\n\n   \nhttps://x.example.com/\n");
  assert.equal(entries.length, 1);
  assert.equal(unparseable.length, 0);
});

test("records 1-based line numbers", () => {
  const { entries } = parseList("# header\nhttps://x.example.com/");
  assert.equal(entries[0].line, 2);
});

test("round-trips the example list through formatEntry", () => {
  const example = [
    "https://stratechery.com/2026/some-article/",
    "https://example.com/podcast-episode | note: the part about pricing power",
    "topic: history of the Czech Republic in the 20th century",
    "topic: how does ASML's EUV light source actually work | depth: deeper",
  ];
  const { entries, unparseable } = parseList(example.join("\n"));
  assert.equal(unparseable.length, 0);
  assert.deepEqual(entries.map(formatEntry), example);
});

test("rejects duplicate tails", () => {
  const r = parseLine("https://x.example.com/ | note: a | note: b");
  assert.equal(r.ok, false);
  assert.match(r.reason, /duplicate/);
});
