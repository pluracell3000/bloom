import { lookup as dnsLookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { isIP } from "node:net";
import sanitizeHtml from "sanitize-html";

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;

function ipv4Number(address) {
  return address.split(".").reduce((value, octet) => (value * 256) + Number(octet), 0) >>> 0;
}

function inIpv4Range(address, base, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4Number(address) & mask) === (ipv4Number(base) & mask);
}

export function isPublicIp(address) {
  const version = isIP(address);
  if (version === 4) {
    return ![
      ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
      ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16],
      ["192.0.2.0", 24], ["192.88.99.0", 24], ["198.18.0.0", 15], ["198.51.100.0", 24],
      ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
    ].some(([base, bits]) => inIpv4Range(address, base, bits));
  }
  if (version === 6) {
    const normalized = address.toLowerCase();
    if (normalized.startsWith("::ffff:")) return isPublicIp(normalized.slice(7));
    return normalized !== "::" && normalized !== "::1" && !normalized.startsWith("100:") &&
      !normalized.startsWith("2001:db8:") && !normalized.startsWith("fc") && !normalized.startsWith("fd") &&
      !/^fe[89ab]/.test(normalized) && !normalized.startsWith("ff");
  }
  return false;
}

export function validateFetchUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("URL must use HTTP(S)");
  if (url.username || url.password) throw new Error("URL credentials are not allowed");
  const expectedPort = url.protocol === "https:" ? "443" : "80";
  if (url.port && url.port !== expectedPort) throw new Error("non-default URL ports are not allowed");
  if (url.hostname.toLowerCase() === "localhost" || url.hostname.toLowerCase().endsWith(".localhost")) {
    throw new Error("local hostnames are not allowed");
  }
  return url;
}

export async function resolvePublicAddress(hostname, lookup = dnsLookup) {
  hostname = hostname.replace(/^\[|\]$/g, "");
  if (isIP(hostname)) {
    if (!isPublicIp(hostname)) throw new Error("URL resolves to a non-public address");
    return hostname;
  }
  const records = await lookup(hostname, { all: true, verbatim: true });
  if (!records.length || records.some(({ address }) => !isPublicIp(address))) {
    throw new Error("URL resolves to a non-public address");
  }
  return records[0].address;
}

function requestPinned(url, address, { maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: "GET",
      headers: { Accept: "text/html,text/plain;q=0.9", "User-Agent": "Bloom/1.0 (+https://github.com/pluracell3000/bloom)" },
      lookup: (_hostname, options, callback) => {
        const family = isIP(address);
        if (options?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > maxBytes) {
          request.destroy(new Error(`response exceeds ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({
        status: response.statusCode || 0,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    request.setTimeout(timeoutMs, () => request.destroy(new Error(`request timed out after ${timeoutMs}ms`)));
    request.on("error", reject);
    request.end();
  });
}

export async function fetchExtractedText(value, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  const lookup = options.lookup || dnsLookup;
  let url = validateFetchUrl(value);

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const address = await resolvePublicAddress(url.hostname, lookup);
    const response = await requestPinned(url, address, { maxBytes, timeoutMs });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirects === maxRedirects) throw new Error("too many redirects");
      if (!response.headers.location) throw new Error("redirect is missing a Location header");
      url = validateFetchUrl(new URL(response.headers.location, url).href);
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw new Error(`source returned HTTP ${response.status}`);
    const contentType = String(response.headers["content-type"] || "").toLowerCase();
    if (!contentType.startsWith("text/html") && !contentType.startsWith("text/plain") && !contentType.startsWith("application/xhtml+xml")) {
      throw new Error(`unsupported source content type: ${contentType || "unknown"}`);
    }
    return sanitizeHtml(response.body, {
      allowedTags: [],
      allowedAttributes: {},
      nonTextTags: ["script", "style", "textarea", "option", "noscript"],
    }).replace(/\s+/g, " ").trim().slice(0, 120_000);
  }
  throw new Error("source could not be fetched");
}
