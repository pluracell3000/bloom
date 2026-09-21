import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeCapture } from "./lib/ingestion.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const inputPath = process.argv[2];
const raw = inputPath ? await readFile(inputPath, "utf8") : await new Promise((resolve, reject) => {
  let value = ""; process.stdin.setEncoding("utf8"); process.stdin.on("data", (chunk) => value += chunk); process.stdin.on("end", () => resolve(value)); process.stdin.on("error", reject);
});
const capture = normalizeCapture(JSON.parse(raw));
const dir = path.join(ROOT, "inbox", "requests", "pending");
await mkdir(dir, { recursive: true });
const out = path.join(dir, `${capture.id}.json`);
await writeFile(out, JSON.stringify(capture, null, 2) + "\n", { flag: "wx" });
console.log(path.relative(ROOT, out));
