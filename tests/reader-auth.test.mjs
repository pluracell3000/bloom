import test from "node:test";
import assert from "node:assert/strict";
import { isAuthorized } from "../scripts/lib/reader-auth.mjs";

test("accepts the exact bearer key", () => {
  assert.equal(isAuthorized("ReaderKey-123", "ReaderKey-123"), false); // not a Bearer header
  assert.equal(isAuthorized("Bearer ReaderKey-123", "ReaderKey-123"), true);
  assert.equal(isAuthorized("bearer ReaderKey-123", "ReaderKey-123"), true);
});

test("rejects wrong, missing, or malformed credentials", () => {
  assert.equal(isAuthorized("Bearer wrong", "ReaderKey-123"), false);
  assert.equal(isAuthorized("Bearer", "ReaderKey-123"), false);
  assert.equal(isAuthorized(undefined, "ReaderKey-123"), false);
  assert.equal(isAuthorized(null, "ReaderKey-123"), false);
  assert.equal(isAuthorized("", "ReaderKey-123"), false);
});

test("fails closed when no reader key is configured", () => {
  assert.equal(isAuthorized("Bearer ReaderKey-123", ""), false);
  assert.equal(isAuthorized("Bearer ReaderKey-123", undefined), false);
});
