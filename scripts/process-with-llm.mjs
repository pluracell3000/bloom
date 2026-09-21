import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import { spawn } from "node:child_process";
import { buildCardPrompt, captureNeedsContent, normalizeCapture } from "./lib/ingestion.mjs";

const capturePath = process.argv[2];
if (!capturePath) throw new Error("usage: node scripts/process-with-llm.mjs <pending-capture.json>");
for (const name of ["BLOOM_LLM_ENDPOINT", "BLOOM_LLM_MODEL", "BLOOM_LLM_API_KEY"]) if (!process.env[name]) throw new Error(`${name} is required`);
const capture = normalizeCapture(JSON.parse(await readFile(capturePath, "utf8")));
if (captureNeedsContent(capture)) throw new Error("URL capture needs payload.extracted_text from a connector before LLM processing");
const response = await fetch(process.env.BLOOM_LLM_ENDPOINT, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${process.env.BLOOM_LLM_API_KEY}` },
  body: JSON.stringify({ model: process.env.BLOOM_LLM_MODEL, temperature: 0.2, response_format: { type: "json_object" }, messages: [{ role: "user", content: buildCardPrompt(capture) }] }),
});
if (!response.ok) throw new Error(`LLM request failed (${response.status})`);
const payload = await response.json();
const content = payload.choices?.[0]?.message?.content;
if (typeof content !== "string") throw new Error("LLM response did not contain choices[0].message.content");
const temp = path.join(os.tmpdir(), `bloom-response-${process.pid}.json`);
await writeFile(temp, content);
const child = spawn(process.execPath, ["scripts/process-capture.mjs", "--capture", capturePath, "--response", temp], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
