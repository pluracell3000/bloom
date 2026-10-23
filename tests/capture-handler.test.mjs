import test from "node:test";
import assert from "node:assert/strict";
import { createCaptureHandler } from "../scripts/lib/capture-handler.mjs";

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(s) { this.code = s; return this; }, json(v) { this.body = v; return this; } };
}
test("browser capture is authenticated, validated, and queued as a web capture", async () => {
  const sent = [];
  const handler = createCaptureHandler({ readerKey: "secret", publish: async (c) => sent.push(c) });
  let res = response();
  await handler({ method: "POST", headers: {}, body: { text: "hello" } }, res);
  assert.equal(res.code, 401);
  assert.equal(sent.length, 0);
  for (const [text, kind] of [["https://example.com/article", "url"], ["How does spaced repetition work?", "topic"]]) {
    res = response();
    await handler({ method: "POST", headers: { authorization: "Bearer secret" }, body: { text } }, res);
    assert.equal(res.code, 202);
    assert.equal(sent.at(-1).kind, kind);
    assert.equal(sent.at(-1).channel, "web");
  }
  res = response();
  await handler({ method: "POST", headers: { authorization: "Bearer secret" }, body: { text: "" } }, res);
  assert.equal(res.code, 400);
});
