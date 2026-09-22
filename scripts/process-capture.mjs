import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildCardPrompt, captureNeedsContent, normalizeCapture, renderCard } from "./lib/ingestion.mjs";
import { createReview } from "./lib/review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
if (!args.capture) throw new Error("usage: node scripts/process-capture.mjs --capture <file> [--response <file>] [--prompt-out <file>] [--publish auto|review]");
const publicationMode = args.publish || "review";
if (!["auto", "review"].includes(publicationMode)) throw new Error("--publish must be auto or review");
const capture = normalizeCapture(JSON.parse(await readFile(args.capture, "utf8")));
if (captureNeedsContent(capture)) throw new Error("URL capture needs payload.extracted_text from a connector before LLM processing");
const prompt = buildCardPrompt(capture);
if (args["prompt-out"]) await writeFile(args["prompt-out"], prompt + "\n");
if (!args.response) { process.stdout.write(prompt + "\n"); process.exit(0); }
const generated = JSON.parse(await readFile(args.response, "utf8"));
const card = renderCard(capture, generated);
let destination;
if (publicationMode === "auto") {
  destination = path.join(ROOT, "cards", card.filename);
  try { await access(destination); throw new Error(`card already exists: ${path.relative(ROOT, destination)}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await writeFile(destination, card.markdown, { flag: "wx" });
} else {
  const review = createReview(capture, card);
  destination = path.join(ROOT, "inbox", "reviews", "pending", review.id);
  await mkdir(destination, { recursive: false });
  await writeFile(path.join(destination, review.capture_file), JSON.stringify(capture, null, 2) + "\n", { flag: "wx" });
  await writeFile(path.join(destination, review.card_file), card.markdown, { flag: "wx" });
  await writeFile(path.join(destination, "review.json"), JSON.stringify(review, null, 2) + "\n", { flag: "wx" });
}
const pendingRoot = path.join(ROOT, "inbox", "requests", "pending") + path.sep;
const capturePath = path.resolve(args.capture);
if (capturePath.startsWith(pendingRoot)) await rm(capturePath);
console.log(path.relative(ROOT, destination));
