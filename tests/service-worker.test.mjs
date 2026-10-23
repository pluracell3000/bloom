import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

test('offline feed reopening uses only the matching reader cache and avoids transport', async () => {
  const entries = new Map();
  let online = true;
  let requests = 0;
  const cache = {
    put: async (request, response) => entries.set(request.url, response.clone()),
    match: async request => entries.get(request.url)?.clone(),
    delete: async request => entries.delete(request.url),
  };
  const sandbox = {
    self: { location: { origin: 'https://bloom.test' }, navigator: { get onLine() { return online; } }, addEventListener() {} },
    caches: { open: async () => cache },
    URL, Request, Response, Headers, TextEncoder, crypto: webcrypto,
    fetch: async () => { requests++; assert.ok(online, 'offline must not contact the transport'); return Response.json({ cards: [{ id: 'private-card' }] }); },
  };
  vm.createContext(sandbox);
  vm.runInContext(await readFile(new URL('../site/sw.js', import.meta.url), 'utf8'), sandbox);
  const request = key => new Request('https://bloom.test/api/feed', { headers: { Authorization: `Bearer ${key}` } });
  assert.equal((await sandbox.networkFirstFeed(request('reader-a'))).status, 200);
  online = false;
  const offline = await sandbox.networkFirstFeed(request('reader-a'));
  assert.equal(offline.headers.get('X-Nightstand-Source'), 'cache');
  assert.equal((await offline.json()).cards[0].id, 'private-card');
  assert.equal((await sandbox.networkFirstFeed(request('reader-b'))).status, 503);
  assert.equal(requests, 1);
  assert.ok([...entries.keys()].every(url => !url.includes('reader-a')));
});
