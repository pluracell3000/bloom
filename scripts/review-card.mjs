import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { validateCard } from "./build-feed.mjs";
import { validateReview } from "./lib/review.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [command, reviewDirArg, ...rest] = process.argv.slice(2);
if (!["approve", "reject"].includes(command) || !reviewDirArg) throw new Error("usage: node scripts/review-card.mjs <approve|reject> <review-directory> [--note <text>]");
const args = Object.fromEntries(rest.reduce((pairs, value, index, all) => value.startsWith("--") ? [...pairs, [value.slice(2), all[index + 1]]] : pairs, []));
const reviewDir = path.resolve(reviewDirArg);
const pendingRoot = path.join(ROOT, "inbox", "reviews", "pending") + path.sep;
if (!reviewDir.startsWith(pendingRoot)) throw new Error("review directory must be under inbox/reviews/pending");
const review = validateReview(JSON.parse(await readFile(path.join(reviewDir, "review.json"), "utf8")));
if (review.state !== "pending") throw new Error(`review is already ${review.state}`);
const cardPath = path.join(reviewDir, review.card_file);
const cardMarkdown = await readFile(cardPath, "utf8");
const errors = validateCard(matter(cardMarkdown), review.card_file);
if (errors.length) throw new Error(`review card is invalid:\n${errors.map((e) => `- ${e}`).join("\n")}`);

if (command === "approve") {
  const destination = path.join(ROOT, "cards", review.card_file);
  try { await access(destination); throw new Error(`card already exists: ${path.relative(ROOT, destination)}`); } catch (error) { if (error.code !== "ENOENT") throw error; }
  await rename(cardPath, destination);
}
review.state = command === "approve" ? "approved" : "rejected";
review.decided_at = new Date().toISOString();
review.decision_note = String(args.note || "").trim();
await writeFile(path.join(reviewDir, "review.json"), JSON.stringify(review, null, 2) + "\n");
const archiveDir = path.join(ROOT, "inbox", "reviews", review.state, path.basename(reviewDir));
await mkdir(path.dirname(archiveDir), { recursive: true });
await rename(reviewDir, archiveDir);
console.log(path.relative(ROOT, archiveDir));
