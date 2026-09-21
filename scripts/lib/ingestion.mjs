import { createHash } from "node:crypto";
import matter from "gray-matter";
import { countWords, validateCard } from "../build-feed.mjs";

export const CAPTURE_VERSION = 1;
export const CAPTURE_KINDS = ["url", "topic", "email"];
export const CAPTURE_CHANNELS = ["cli", "email", "web", "whatsapp", "api", "other"];

const nonEmpty = (value) => typeof value === "string" && value.trim().length > 0;
const clean = (value) => (typeof value === "string" ? value.trim() : "");

export function normalizeCapture(input, { now = new Date() } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("capture must be an object");
  const kind = clean(input.kind).toLowerCase();
  const channel = clean(input.channel || "other").toLowerCase();
  if (!CAPTURE_KINDS.includes(kind)) throw new Error(`kind must be one of: ${CAPTURE_KINDS.join(", ")}`);
  if (!CAPTURE_CHANNELS.includes(channel)) throw new Error(`channel must be one of: ${CAPTURE_CHANNELS.join(", ")}`);

  const payload = input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload : {};
  const normalizedPayload = { note: clean(payload.note) };
  if (kind === "topic") {
    if (!nonEmpty(payload.prompt)) throw new Error("topic capture requires payload.prompt");
    normalizedPayload.prompt = clean(payload.prompt);
  }
  if (kind === "url") {
    if (!nonEmpty(payload.url)) throw new Error("url capture requires payload.url");
    let url;
    try { url = new URL(clean(payload.url)); } catch { throw new Error("payload.url must be an absolute http(s) URL"); }
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("payload.url must be an absolute http(s) URL");
    normalizedPayload.url = url.href;
    normalizedPayload.title = clean(payload.title);
    normalizedPayload.author = clean(payload.author);
    normalizedPayload.extracted_text = clean(payload.extracted_text);
  }
  if (kind === "email") {
    if (!nonEmpty(payload.subject)) throw new Error("email capture requires payload.subject");
    if (!nonEmpty(payload.body)) throw new Error("email capture requires payload.body");
    normalizedPayload.subject = clean(payload.subject);
    normalizedPayload.body = clean(payload.body);
    normalizedPayload.from = clean(payload.from);
    normalizedPayload.source_url = clean(payload.source_url);
  }

  const receivedAt = input.received_at ? new Date(input.received_at) : now;
  if (Number.isNaN(receivedAt.getTime())) throw new Error("received_at must be an ISO date-time");
  const stable = JSON.stringify({ kind, channel, payload: normalizedPayload, received_at: receivedAt.toISOString() });
  const id = clean(input.id) || `cap-${receivedAt.toISOString().slice(0, 10).replaceAll("-", "")}-${createHash("sha256").update(stable).digest("hex").slice(0, 12)}`;
  if (!/^cap-[a-zA-Z0-9-]{8,80}$/.test(id)) throw new Error("id must start with cap- and contain only letters, numbers, and hyphens");

  return { schema_version: CAPTURE_VERSION, id, kind, channel, received_at: receivedAt.toISOString(), payload: normalizedPayload };
}

export function captureNeedsContent(capture) {
  return capture.kind === "url" && !capture.payload.extracted_text;
}

export function buildCardPrompt(capture) {
  const source = capture.kind === "topic"
    ? `Research topic: ${capture.payload.prompt}`
    : capture.kind === "email"
      ? `Forwarded email\nSubject: ${capture.payload.subject}\nFrom: ${capture.payload.from || "unknown"}\n\n${capture.payload.body}`
      : `URL: ${capture.payload.url}\nTitle: ${capture.payload.title || "unknown"}\nAuthor: ${capture.payload.author || "unknown"}\n\nExtracted source text:\n${capture.payload.extracted_text}`;
  return [
    "Create one Bloom/Nightstand learning card from the capture below.",
    "Return JSON only. Do not wrap it in Markdown.",
    "Use this exact object shape: title, source_type, source_title, source_url, author, topic_prompt, sources, tags, tldr, pull_quote, recall_question, recall_answer, body_markdown.",
    "source_type must be article, newsletter, podcast, video, book, or topic.",
    "tldr must contain 2-4 non-empty strings. tags must be a non-empty string array.",
    "body_markdown must be 300-900 words and teach the mechanism in 2-4 short sections. Do not invent inaccessible source facts.",
    "For a topic, provide 2-5 real source URLs in sources. For other kinds, source_title, source_url, and author are required.",
    "recall_question should test why/how; recall_answer must be at most two sentences.",
    capture.payload.note ? `Requested angle: ${capture.payload.note}` : "",
    source,
  ].filter(Boolean).join("\n\n");
}

export function slugify(value) {
  return String(value).normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54) || "card";
}

export function renderCard(capture, generated, { day = capture.received_at.slice(0, 10) } = {}) {
  if (!generated || typeof generated !== "object" || Array.isArray(generated)) throw new Error("LLM response must be a JSON object");
  const title = clean(generated.title);
  const id = `${day}-${slugify(title)}`;
  const body = clean(generated.body_markdown);
  const readingMinutes = Math.max(1, Math.ceil(countWords(body) / 180));
  const data = {
    id,
    title,
    source_type: clean(generated.source_type),
    source_title: clean(generated.source_title),
    source_url: clean(generated.source_url),
    author: clean(generated.author),
    topic_prompt: clean(generated.topic_prompt),
    sources: Array.isArray(generated.sources) ? generated.sources.map(clean).filter(Boolean) : [],
    created: day,
    tags: Array.isArray(generated.tags) ? generated.tags.map(clean).filter(Boolean) : [],
    reading_minutes: readingMinutes,
    tldr: Array.isArray(generated.tldr) ? generated.tldr.map(clean) : [],
    pull_quote: clean(generated.pull_quote),
    recall_question: clean(generated.recall_question),
    recall_answer: clean(generated.recall_answer),
  };
  const markdown = matter.stringify(`${body}\n`, data);
  const errors = validateCard(matter(markdown), `${id}.md`);
  if (errors.length) throw new Error(`generated card is invalid:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  return { id, filename: `${id}.md`, markdown };
}
