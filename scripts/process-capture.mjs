import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCardPrompt, captureNeedsContent, normalizeCapture, renderCard } from "./lib/ingestion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
if (!args.capture) throw new Error("usage: node scripts/process-capture.mjs --capture <file> [--response <file>] [--prompt-out <file>]");
const capture = normalizeCapture(JSON.parse(await readFile(args.capture, "utf8")));
if (captureNeedsContent(capture)) throw new Error("URL capture needs payload.extracted_text from a connector before LLM processing");
const prompt = buildCardPrompt(capture);
if (args["prompt-out"]) await writeFile(args["prompt-out"], prompt + "\n");
if (!args.response) { process.stdout.write(prompt + "\n"); process.exit(0); }
const generated = JSON.parse(await readFile(args.response, "utf8"));
const card = renderCard(capture, generated);
const cardPath = path.join(ROOT, "cards", card.filename);
await writeFile(cardPath, card.markdown, { flag: "wx" });
const processedDir = path.join(ROOT, "inbox", "requests", "processed");
await mkdir(processedDir, { recursive: true });
await rename(args.capture, path.join(processedDir, path.basename(args.capture)));
console.log(path.relative(ROOT, cardPath));
