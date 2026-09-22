import test from "node:test";
import assert from "node:assert/strict";
import { isPublicIp, resolvePublicAddress, validateFetchUrl } from "../scripts/lib/safe-fetch.mjs";

test("classifies public and non-public IP addresses", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.1", "198.51.100.1", "::1", "2001:db8::1", "fd00::1", "fe80::1"]) {
    assert.equal(isPublicIp(address), false, address);
  }
  for (const address of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) {
    assert.equal(isPublicIp(address), true, address);
  }
});

test("fetch URLs reject local targets, credentials, and custom ports", () => {
  assert.throws(() => validateFetchUrl("http://localhost/admin"), /local hostnames/);
  assert.throws(() => validateFetchUrl("http://user:pass@example.com/"), /credentials/);
  assert.throws(() => validateFetchUrl("https://example.com:8443/"), /ports/);
  assert.throws(() => validateFetchUrl("file:///etc/passwd"), /HTTP/);
  assert.equal(validateFetchUrl("https://example.com/read").hostname, "example.com");
});

test("DNS validation rejects a hostname if any answer is non-public", async () => {
  await assert.rejects(
    resolvePublicAddress("example.test", async () => [{ address: "203.0.113.1" }, { address: "127.0.0.1" }]),
    /non-public/,
  );
  assert.equal(await resolvePublicAddress("example.test", async () => [{ address: "8.8.8.8" }]), "8.8.8.8");
  await assert.rejects(resolvePublicAddress("[::1]"), /non-public/);
});
