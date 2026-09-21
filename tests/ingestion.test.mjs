import test from "node:test";
import assert from "node:assert/strict";
import matter from "gray-matter";
import { buildCardPrompt, captureNeedsContent, normalizeCapture, renderCard } from "../scripts/lib/ingestion.mjs";
import { validateCard } from "../scripts/build-feed.mjs";

const now = new Date("2026-09-21T09:00:00.000Z");
const generated = {
  title: "Why queues absorb bursts",
  source_type: "topic",
  source_title: "", source_url: "", author: "", topic_prompt: "queueing basics",
  sources: ["https://example.com/one", "https://example.com/two"], tags: ["systems"],
  tldr: ["Queues trade latency for resilience.", "Capacity still bounds recovery."], pull_quote: "A queue moves overload through time.",
  recall_question: "Why can a queue help with a burst but not permanent overload?",
  recall_answer: "It delays work until spare capacity returns. If arrival rate stays above service rate, the backlog grows without bound.",
  body_markdown: Array.from({ length: 330 }, (_, i) => i % 80 === 0 ? `\n\n## Mechanism ${i}\n\nword${i}` : `word${i}`).join(" "),
};

test("normalizes each channel-independent capture kind", () => {
  const topic = normalizeCapture({ kind: "topic", channel: "whatsapp", payload: { prompt: " queueing basics " } }, { now });
  assert.equal(topic.payload.prompt, "queueing basics");
  assert.match(topic.id, /^cap-20260921-/);
  const url = normalizeCapture({ kind: "url", channel: "web", payload: { url: "https://example.com/post" } }, { now });
  assert.equal(captureNeedsContent(url), true);
  const email = normalizeCapture({ kind: "email", channel: "email", payload: { subject: "Read this", body: "Long forwarded body" } }, { now });
  assert.equal(email.payload.subject, "Read this");
});

test("rejects incomplete or unsafe captures", () => {
  assert.throws(() => normalizeCapture({ kind: "url", payload: { url: "file:///etc/passwd" } }, { now }), /http\(s\)/);
  assert.throws(() => normalizeCapture({ kind: "email", payload: { subject: "x" } }, { now }), /body/);
  assert.throws(() => normalizeCapture({ kind: "unknown", payload: {} }, { now }), /kind/);
});

test("prompt is connector-agnostic and preserves capture context", () => {
  const capture = normalizeCapture({ kind: "email", channel: "email", payload: { subject: "Read this", body: "Forwarded text", note: "focus on incentives" } }, { now });
  const prompt = buildCardPrompt(capture);
  assert.match(prompt, /focus on incentives/);
  assert.match(prompt, /Forwarded text/);
  assert.match(prompt, /Return JSON only/);
});

test("renders only schema-valid generated cards", () => {
  const capture = normalizeCapture({ kind: "topic", channel: "cli", payload: { prompt: "queueing basics" } }, { now });
  const card = renderCard(capture, generated);
  assert.equal(card.filename, "2026-09-21-why-queues-absorb-bursts.md");
  assert.deepEqual(validateCard(matter(card.markdown), card.filename), []);
  assert.throws(() => renderCard(capture, { ...generated, tldr: [] }), /generated card is invalid/);
});
