import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createReview } from "../scripts/lib/review.mjs";
import { normalizeCapture, renderCard } from "../scripts/lib/ingestion.mjs";

const root = path.resolve(".");
const words = Array.from({ length: 320 }, (_, i) => `word${i}`).join(" ");
const generated = {
  title: "Review flow test card", source_type: "topic", source_title: "", source_url: "", author: "", topic_prompt: "review flow",
  sources: ["https://example.com/a", "https://example.com/b"], tags: ["testing"], tldr: ["First", "Second"], pull_quote: "A quote.",
  recall_question: "Why review?", recall_answer: "To catch mistakes.", body_markdown: words,
};

async function fixture() {
  const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const capture = normalizeCapture({ id: `cap-20260921-${suffix}`, kind: "topic", channel: "cli", payload: { prompt: "review flow" } }, { now: new Date("2026-09-21T12:00:00Z") });
  const card = renderCard(capture, generated);
  const review = createReview(capture, card, { now: new Date("2026-09-21T12:01:00Z") });
  const dir = path.join(root, "inbox", "reviews", "pending", review.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, review.capture_file), JSON.stringify(capture));
  await writeFile(path.join(dir, review.card_file), card.markdown);
  await writeFile(path.join(dir, "review.json"), JSON.stringify(review));
  return { dir, review };
}

async function exists(file) { try { await access(file); return true; } catch { return false; } }

test("approval is the only step that moves a preview into cards", async (t) => {
  const { dir, review } = await fixture();
  const cardDestination = path.join(root, "cards", review.card_file);
  const archive = path.join(root, "inbox", "reviews", "approved", review.id);
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(cardDestination, { force: true }); await rm(archive, { recursive: true, force: true }); });
  assert.equal(await exists(cardDestination), false);
  const result = spawnSync(process.execPath, ["scripts/review-card.mjs", "approve", dir, "--note", "tested"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await exists(cardDestination), true);
  const stored = JSON.parse(await readFile(path.join(archive, "review.json"), "utf8"));
  assert.equal(stored.state, "approved");
  assert.equal(stored.decision_note, "tested");
});

test("rejection archives the preview without publishing", async (t) => {
  const { dir, review } = await fixture();
  const cardDestination = path.join(root, "cards", review.card_file);
  const archive = path.join(root, "inbox", "reviews", "rejected", review.id);
  t.after(async () => { const { rm } = await import("node:fs/promises"); await rm(archive, { recursive: true, force: true }); });
  const result = spawnSync(process.execPath, ["scripts/review-card.mjs", "reject", dir], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await exists(cardDestination), false);
  const stored = JSON.parse(await readFile(path.join(archive, "review.json"), "utf8"));
  assert.equal(stored.state, "rejected");
});
