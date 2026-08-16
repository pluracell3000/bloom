import test from "node:test";
import assert from "node:assert/strict";
import {
  STATE_VERSION,
  emptyState,
  validateState,
  migrate,
  loadState,
  saveState,
  exportPayload,
  importPayload,
} from "../site/state.mjs";

// Minimal localStorage stub (Node has none).
function makeLocalStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
    _map: map,
  };
}

function withLocalStorage(ls, fn) {
  globalThis.localStorage = ls;
  return Promise.resolve(fn()).finally(() => {
    delete globalThis.localStorage;
  });
}

const validState = () => ({
  state_version: STATE_VERSION,
  updated_at: "2026-08-16T10:00:00.000Z",
  cards: {
    "2026-08-15-tsmc-arizona-yield": {
      first_read: "2026-08-16",
      last_review: null,
      interval_index: 0,
      retired: false,
    },
  },
});

test("emptyState validates", () => {
  assert.equal(validateState(emptyState()).state_version, STATE_VERSION);
});

test("validateState rejects bad shapes with specific messages", () => {
  assert.throws(() => validateState(null), /not an object/);
  assert.throws(() => validateState({ state_version: 99, cards: {} }), /unknown state_version/);
  assert.throws(() => validateState({ state_version: 1, updated_at: null, cards: [] }), /cards must be an object/);
  const bad = validState();
  bad.cards.x = { first_read: "not-a-day", last_review: null, interval_index: 0, retired: false };
  assert.throws(() => validateState(bad), /card x: bad first_read/);
});

test("migrate passes current version through and rejects future versions", () => {
  const s = validState();
  assert.equal(migrate(s), s);
  assert.throws(() => migrate({ state_version: STATE_VERSION + 1, cards: {} }), /newer than this app/);
  assert.throws(() => migrate("garbage"), /unmigratable/);
  assert.throws(() => migrate({}), /no state_version/);
});

test("loadState: empty stores → fresh state, no notice", async () => {
  await withLocalStorage(makeLocalStorage(), async () => {
    const { state, notice } = await loadState();
    assert.equal(notice, null);
    assert.deepEqual(state.cards, {});
  });
});

test("loadState: corrupt localStorage is quarantined, boots reset notice", async () => {
  const ls = makeLocalStorage({ "nightstand.state": "{definitely not json" });
  await withLocalStorage(ls, async () => {
    const { state, notice } = await loadState();
    assert.equal(notice, "reset");
    assert.deepEqual(state.cards, {});
    // The corrupt blob was preserved, not overwritten.
    const quarantined = [...ls._map.keys()].filter((k) => k.startsWith("nightstand.quarantine."));
    assert.equal(quarantined.length, 1);
    assert.equal(ls._map.get(quarantined[0]), "{definitely not json");
    // The original key is untouched until the next save.
    assert.equal(ls.getItem("nightstand.state"), "{definitely not json");
  });
});

test("loadState: valid state round-trips through saveState", async () => {
  const ls = makeLocalStorage();
  await withLocalStorage(ls, async () => {
    const s = validState();
    await saveState(s);
    assert.ok(s.updated_at > "2026-08-16T10:00:00.000Z"); // restamped at save
    const { state, notice } = await loadState();
    assert.equal(notice, null);
    assert.deepEqual(state.cards, s.cards);
  });
});

test("export → import restores state exactly", async () => {
  const s = validState();
  const { filename, json } = exportPayload(s);
  assert.match(filename, /^nightstand-state-.*\.json$/);
  const restored = importPayload(json);
  assert.deepEqual(restored, s);
});

test("importPayload rejects non-JSON and invalid states clearly", () => {
  assert.throws(() => importPayload("not json"), /isn't JSON/);
  assert.throws(() => importPayload('{"state_version": 42}'), /newer than this app/);
  assert.throws(() => importPayload('{"hello": 1}'), /no state_version/);
});
