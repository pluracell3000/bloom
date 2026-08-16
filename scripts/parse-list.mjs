// parse-list.mjs — parse inbox/list.md into structured entries.
//
// Grammar (one entry per line):
//   <url>                                  → { kind: "link", url }
//   topic: <prompt>                        → { kind: "topic", prompt }
// Either form may carry an optional tail:  | note: <text>   and/or   | depth: <value>
// Blank lines and lines starting with # are ignored.
// Anything else is returned under `unparseable` — never silently dropped.

const URL_RE = /^https?:\/\/\S+$/i;

/**
 * Parse the raw text of inbox/list.md.
 * @param {string} text
 * @returns {{ entries: Array<object>, unparseable: Array<{line: number, text: string, reason: string}> }}
 */
export function parseList(text) {
  const entries = [];
  const unparseable = [];

  const lines = String(text ?? "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;

    const parsed = parseLine(line);
    if (parsed.ok) {
      entries.push({ ...parsed.entry, line: i + 1, raw });
    } else {
      unparseable.push({ line: i + 1, text: raw, reason: parsed.reason });
    }
  }

  return { entries, unparseable };
}

/**
 * Parse a single trimmed, non-empty line.
 * @param {string} line
 * @returns {{ok: true, entry: object} | {ok: false, reason: string}}
 */
export function parseLine(line) {
  const parts = line.split("|");
  const head = parts[0].trim();
  const tails = parts.slice(1);

  const meta = {};
  for (const tail of tails) {
    const t = tail.trim();
    if (t === "") continue;
    const m = t.match(/^(note|depth)\s*:\s*(.+)$/i);
    if (!m) {
      return { ok: false, reason: `unrecognized tail "${t}" (expected "note: ..." or "depth: ...")` };
    }
    const key = m[1].toLowerCase();
    if (meta[key] !== undefined) {
      return { ok: false, reason: `duplicate tail "${key}:"` };
    }
    meta[key] = m[2].trim();
  }

  const topicMatch = head.match(/^topic\s*:\s*(.*)$/i);
  if (topicMatch) {
    const prompt = topicMatch[1].trim();
    if (prompt === "") {
      return { ok: false, reason: "topic line has an empty prompt" };
    }
    return { ok: true, entry: { kind: "topic", prompt, ...meta } };
  }

  if (URL_RE.test(head)) {
    return { ok: true, entry: { kind: "link", url: head, ...meta } };
  }

  return {
    ok: false,
    reason: 'line is neither a URL nor "topic: <prompt>"',
  };
}

/**
 * Serialize entries back into list.md lines (round-trip helper for /inbox).
 * @param {Array<object>} entries
 * @returns {string}
 */
export function formatEntry(entry) {
  let head;
  if (entry.kind === "topic") head = `topic: ${entry.prompt}`;
  else head = entry.url;
  const tails = [];
  if (entry.note) tails.push(`note: ${entry.note}`);
  if (entry.depth) tails.push(`depth: ${entry.depth}`);
  return tails.length ? `${head} | ${tails.join(" | ")}` : head;
}
