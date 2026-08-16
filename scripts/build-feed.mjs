// build-feed.mjs — compile and validate cards/*.md into site/feed.json.
//
// Validation hard-fails, naming the file and the violation. The feed is
// sorted newest-first by `created` (normalized to an ISO YYYY-MM-DD string —
// gray-matter parses bare YAML dates into JS Date objects, which would
// otherwise break string sorting).

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";

export const SCHEMA_VERSION = 1;

const SOURCE_TYPES = ["article", "newsletter", "podcast", "video", "book", "topic"];
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARDS_DIR = path.join(ROOT, "cards");
const OUT_FILE = path.join(ROOT, "site", "feed.json");

/** Normalize a YAML date (JS Date or string) to "YYYY-MM-DD". */
export function normalizeDate(value) {
  if (value instanceof Date) {
    // gray-matter/js-yaml parses bare dates as UTC midnight; read back in UTC.
    return value.toISOString().slice(0, 10);
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  return null;
}

export function countWords(markdown) {
  const text = String(markdown)
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*_`~\-|]/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w));
  return words.length;
}

/**
 * Validate one parsed card. Returns a list of violation strings (empty = valid).
 * @param {{ data: object, content: string }} parsed
 * @param {string} filename
 */
export function validateCard(parsed, filename) {
  const errors = [];
  const d = parsed.data;
  const err = (msg) => errors.push(msg);

  if (!d.id || typeof d.id !== "string") err("missing or non-string `id`");
  else if (d.id !== path.basename(filename, ".md")) {
    err(`\`id\` ("${d.id}") does not match filename ("${path.basename(filename, ".md")}")`);
  }

  if (!d.title || typeof d.title !== "string" || !d.title.trim()) err("missing `title`");

  if (!SOURCE_TYPES.includes(d.source_type)) {
    err(`\`source_type\` must be one of ${SOURCE_TYPES.join(", ")} (got "${d.source_type}")`);
  }

  const isTopic = d.source_type === "topic";
  if (isTopic) {
    if (!d.topic_prompt || !String(d.topic_prompt).trim()) err("topic card missing `topic_prompt`");
    if (!Array.isArray(d.sources) || d.sources.length < 2 || d.sources.length > 5) {
      err(`topic card requires 2–5 \`sources\` (got ${Array.isArray(d.sources) ? d.sources.length : "none"})`);
    }
  } else {
    for (const field of ["source_title", "source_url", "author"]) {
      if (!d[field] || !String(d[field]).trim()) err(`link card missing \`${field}\``);
    }
  }

  const created = normalizeDate(d.created);
  if (!created) err("missing or malformed `created` (expected YYYY-MM-DD)");

  if (!Array.isArray(d.tldr) || d.tldr.length < 2 || d.tldr.length > 4) {
    err(`\`tldr\` must have 2–4 items (got ${Array.isArray(d.tldr) ? d.tldr.length : "none"})`);
  } else if (d.tldr.some((t) => !t || !String(t).trim())) {
    err("`tldr` contains an empty item");
  }

  if (!d.pull_quote || !String(d.pull_quote).trim()) err("missing `pull_quote`");
  if (!d.recall_question || !String(d.recall_question).trim()) err("missing `recall_question`");
  if (!d.recall_answer || !String(d.recall_answer).trim()) err("missing `recall_answer`");

  if (!Number.isInteger(d.reading_minutes) || d.reading_minutes < 1) {
    err("`reading_minutes` must be a positive integer");
  }

  if (!Array.isArray(d.tags) || d.tags.length === 0) err("missing `tags`");

  const words = countWords(parsed.content);
  if (words < 300 || words > 900) {
    err(`body must be 300–900 words (got ${words})`);
  }

  return errors;
}

/** Build the feed object from a directory of card files. Throws on any violation. */
export async function buildFeed(cardsDir = CARDS_DIR) {
  let files;
  try {
    files = (await readdir(cardsDir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    files = [];
  }

  const cards = [];
  const seenIds = new Set();
  const allErrors = [];

  for (const file of files) {
    const raw = await readFile(path.join(cardsDir, file), "utf8");
    let parsed;
    try {
      parsed = matter(raw);
    } catch (e) {
      allErrors.push(`${file}: bad frontmatter (${e.message.split("\n")[0]})`);
      continue;
    }

    const errors = validateCard(parsed, file);
    if (parsed.data.id && seenIds.has(parsed.data.id)) {
      errors.push(`duplicate id "${parsed.data.id}"`);
    }
    if (errors.length) {
      allErrors.push(...errors.map((e) => `${file}: ${e}`));
      continue;
    }
    seenIds.add(parsed.data.id);

    const d = parsed.data;
    cards.push({
      id: d.id,
      title: d.title,
      source_type: d.source_type,
      source_title: d.source_title || "",
      source_url: d.source_url || "",
      author: d.author || "",
      topic_prompt: d.topic_prompt || "",
      sources: Array.isArray(d.sources) ? d.sources : [],
      created: normalizeDate(d.created),
      tags: d.tags,
      reading_minutes: d.reading_minutes,
      tldr: d.tldr.map(String),
      pull_quote: String(d.pull_quote),
      recall_question: String(d.recall_question),
      recall_answer: String(d.recall_answer),
      word_count: countWords(parsed.content),
      body_html: marked.parse(parsed.content, { async: false }),
    });
  }

  if (allErrors.length) {
    const message = ["feed build failed:", ...allErrors.map((e) => `  ✗ ${e}`)].join("\n");
    const error = new Error(message);
    error.violations = allErrors;
    throw error;
  }

  // Newest first; stable tiebreak on id so ordering is deterministic.
  cards.sort((a, b) => (a.created === b.created ? b.id.localeCompare(a.id) : b.created.localeCompare(a.created)));

  return {
    schema_version: SCHEMA_VERSION,
    generated_at: new Date().toISOString(),
    card_count: cards.length,
    cards,
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const feed = await buildFeed();
    await writeFile(OUT_FILE, JSON.stringify(feed, null, 2) + "\n");
    console.log(`✓ feed.json: ${feed.card_count} card(s), schema_version ${feed.schema_version}`);
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
