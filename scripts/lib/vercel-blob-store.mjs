// vercel-blob-store.mjs — private card and feed storage on Vercel Blob.
// Everything is written with access: "private": card markdown and the compiled
// feed have no public URL and can only be streamed server-side with the
// store token. Cards and source content never touch Git.

import path from "node:path";
import { get, list, put } from "@vercel/blob";

export const CARDS_PREFIX = "cards/";
export const QUARANTINE_PREFIX = "quarantine/";
export const FEED_PATHNAME = "feed.json";

async function streamToText(stream) {
  return new Response(stream).text();
}

/**
 * Create the hosted card store. Every method is dependency-injectable for
 * tests. `token` comes from the Blob store's BLOB_READ_WRITE_TOKEN, which
 * Vercel injects automatically once a store is connected to the project.
 */
export function createBlobStore({ token, putImpl = put, getImpl = get, listImpl = list } = {}) {
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN is required");

  async function putCardMarkdown(filename, markdown) {
    if (path.basename(filename) !== filename || !filename.endsWith(".md")) {
      throw new Error("card filename must be a Markdown basename");
    }
    return putImpl(`${CARDS_PREFIX}${filename}`, markdown, {
      access: "private",
      token,
      contentType: "text/markdown; charset=utf-8",
      addRandomSuffix: false,
      allowOverwrite: false,
    });
  }

  async function listCardMarkdown() {
    const sources = [];
    let cursor;
    do {
      const page = await listImpl({ prefix: CARDS_PREFIX, limit: 1000, cursor, token });
      for (const blob of page.blobs) {
        if (!blob.pathname.endsWith(".md")) continue;
        const { stream } = await getImpl(blob.pathname, { access: "private", token });
        sources.push({ filename: path.basename(blob.pathname), raw: await streamToText(stream) });
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return sources;
  }

  async function putFeed(feed) {
    return putImpl(FEED_PATHNAME, JSON.stringify(feed, null, 2) + "\n", {
      access: "private",
      token,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  async function getFeed() {
    return getImpl(FEED_PATHNAME, { access: "private", token });
  }

  async function putQuarantine(name, record) {
    if (path.basename(name) !== name || !name.endsWith(".json")) {
      throw new Error("quarantine name must be a JSON basename");
    }
    return putImpl(`${QUARANTINE_PREFIX}${name}`, JSON.stringify(record, null, 2) + "\n", {
      access: "private",
      token,
      contentType: "application/json",
      addRandomSuffix: false,
      allowOverwrite: true,
    });
  }

  return { putCardMarkdown, listCardMarkdown, putFeed, getFeed, putQuarantine };
}
