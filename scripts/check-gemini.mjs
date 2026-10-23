// Safe deployment preflight: list model names/methods, never keys or raw errors.
// No generation call, credential rotation, or automatic model substitution.
const apiKey = process.env.BLOOM_GEMINI_API_KEY;
const model = process.env.BLOOM_GEMINI_MODEL;
if (!apiKey || !model) {
  if (!process.argv.includes("--if-configured")) throw new Error("Gemini configuration missing");
  console.log("Gemini preflight skipped: credentials not configured in this environment");
} else {
  let pageToken;
  const available = [];
  do {
    const url = new URL("https://generativelanguage.googleapis.com/v1beta/models");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: { "x-goog-api-key": apiKey }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Gemini model discovery HTTP ${response.status}`);
    const data = await response.json();
    for (const item of data.models || []) {
      if (item.supportedGenerationMethods?.includes("generateContent")) available.push(item.name);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);
  console.log("Gemini generateContent models:", available.join(", "));
  if (!available.includes(`models/${model}`)) throw new Error("Configured BLOOM_GEMINI_MODEL is unavailable for this key/API version; choose a listed model explicitly.");
  console.log("Configured Gemini model supports generateContent on v1beta");
  if (process.argv.includes("--probe")) {
    const { generateCardWithGemini } = await import("./lib/gemini-client.mjs");
    const { normalizeCapture, buildCardPrompt, renderCard } = await import("./lib/ingestion.mjs");
    const capture = normalizeCapture({ kind: "topic", channel: "api", payload: { prompt: "Explain spaced repetition and why retrieval practice helps memory." } });
    for (const candidate of [...new Set([model, "gemini-flash-latest"])]) {
      if (!available.includes(`models/${candidate}`)) continue;
      try {
        const generated = await generateCardWithGemini(buildCardPrompt(capture), { apiKey, model: candidate });
        renderCard(capture, generated);
        console.log(`Gemini structured generation and card validation passed: ${candidate}`);
      } catch (error) {
        console.log(`Gemini probe failed: ${candidate}: ${error.message.startsWith("Gemini request failed (") ? error.message : "response or card validation failed"}`);
      }
    }
  }
}
