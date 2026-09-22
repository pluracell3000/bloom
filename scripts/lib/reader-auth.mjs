// reader-auth.mjs — shared-secret gate for the private feed API. The reader
// key is a deployment secret; the browser holds it in localStorage and sends
// it as a bearer token. Compared via hashes so timing leaks nothing useful.

import { createHash, timingSafeEqual } from "node:crypto";

function digest(value) {
  return createHash("sha256").update(String(value)).digest();
}

export function isAuthorized(authorizationHeader, readerKey) {
  if (!readerKey || typeof authorizationHeader !== "string") return false;
  const match = authorizationHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  return timingSafeEqual(digest(match[1].trim()), digest(readerKey));
}
