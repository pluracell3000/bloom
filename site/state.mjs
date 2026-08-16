// state.mjs — device reading state: dual storage (localStorage + IndexedDB),
// versioned with pure migrations, quarantine-on-corruption, export/import.
//
// Shape (STATE_VERSION 1):
//   {
//     state_version: 1,
//     updated_at: "<ISO timestamp of last save>",
//     cards: { [cardId]: { first_read, last_review, interval_index, retired } }
//   }

import { isDayKey, INTERVALS } from "./scheduler.mjs";

export const STATE_VERSION = 1;
const LS_KEY = "nightstand.state";
const QUARANTINE_PREFIX = "nightstand.quarantine.";
const IDB_NAME = "nightstand";
const IDB_STORE = "kv";

export function emptyState() {
  return { state_version: STATE_VERSION, updated_at: null, cards: {} };
}

/** Throws with a specific message if the object is not a valid state. */
export function validateState(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    throw new Error("state is not an object");
  }
  if (obj.state_version !== STATE_VERSION) {
    throw new Error(`unknown state_version ${JSON.stringify(obj.state_version)}`);
  }
  if (obj.updated_at !== null && typeof obj.updated_at !== "string") {
    throw new Error("updated_at must be null or an ISO string");
  }
  if (!obj.cards || typeof obj.cards !== "object" || Array.isArray(obj.cards)) {
    throw new Error("cards must be an object");
  }
  for (const [id, cs] of Object.entries(obj.cards)) {
    if (!cs || typeof cs !== "object") throw new Error(`card ${id}: not an object`);
    if (cs.first_read !== null && !isDayKey(cs.first_read)) {
      throw new Error(`card ${id}: bad first_read`);
    }
    if (cs.last_review !== null && !isDayKey(cs.last_review)) {
      throw new Error(`card ${id}: bad last_review`);
    }
    if (!Number.isInteger(cs.interval_index) || cs.interval_index < 0 || cs.interval_index >= INTERVALS.length) {
      throw new Error(`card ${id}: bad interval_index`);
    }
    if (typeof cs.retired !== "boolean") throw new Error(`card ${id}: bad retired`);
  }
  return obj;
}

/**
 * Pure migration: any prior on-disk shape → current STATE_VERSION.
 * Every future version bump adds a step here. Throws if unmigratable.
 */
export function migrate(old) {
  if (!old || typeof old !== "object") throw new Error("unmigratable: not an object");
  if (typeof old.state_version !== "number") throw new Error("unmigratable: no state_version");
  if (old.state_version > STATE_VERSION) {
    throw new Error(`state_version ${old.state_version} is newer than this app understands`);
  }
  let state = old;
  // v1 is the first version — no steps yet. Future example:
  // if (state.state_version === 1) state = migrateV1toV2(state);
  return validateState(state);
}

// ---------------------------------------------------------------------------
// Storage backends. Both are best-effort; reconciliation happens at load.

function idbAvailable() {
  return typeof indexedDB !== "undefined";
}

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

async function idbSet(key, value) {
  const db = await idbOpen();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

function quarantine(raw, source) {
  try {
    const key = `${QUARANTINE_PREFIX}${Date.now()}.${source}`;
    localStorage.setItem(key, typeof raw === "string" ? raw : JSON.stringify(raw));
    return key;
  } catch {
    return null;
  }
}

function parseCandidate(raw) {
  const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
  return migrate(obj);
}

/**
 * Load device state: read both stores, reconcile by most-recent `updated_at`,
 * quarantine anything corrupt instead of overwriting it.
 * @returns {Promise<{state: object, notice: null | "reset"}>}
 */
export async function loadState() {
  const candidates = [];
  let corruptionSeen = false;

  let lsRaw = null;
  try {
    lsRaw = localStorage.getItem(LS_KEY);
  } catch {
    /* storage unavailable */
  }
  if (lsRaw !== null) {
    try {
      candidates.push(parseCandidate(lsRaw));
    } catch {
      corruptionSeen = true;
      quarantine(lsRaw, "localStorage");
    }
  }

  if (idbAvailable()) {
    let idbRaw;
    try {
      idbRaw = await idbGet("state");
    } catch {
      idbRaw = undefined;
    }
    if (idbRaw !== undefined && idbRaw !== null) {
      try {
        candidates.push(parseCandidate(idbRaw));
      } catch {
        corruptionSeen = true;
        quarantine(idbRaw, "indexedDB");
      }
    }
  }

  if (candidates.length === 0) {
    return { state: emptyState(), notice: corruptionSeen ? "reset" : null };
  }
  candidates.sort((a, b) => String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? "")));
  return { state: candidates[0], notice: null };
}

/** Dual-write the state to localStorage and IndexedDB, stamping updated_at. */
export async function saveState(state) {
  state.updated_at = new Date().toISOString();
  const json = JSON.stringify(state);
  try {
    localStorage.setItem(LS_KEY, json);
  } catch {
    /* keep going — IDB may still succeed */
  }
  if (idbAvailable()) {
    try {
      await idbSet("state", json);
    } catch {
      /* localStorage already has it */
    }
  }
  return state;
}

// ---------------------------------------------------------------------------
// Export / import — disaster recovery; must always work.

export function exportPayload(state) {
  const stamp = new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
  return {
    filename: `nightstand-state-${stamp}.json`,
    json: JSON.stringify(state, null, 2),
  };
}

/** Validate + migrate imported JSON text. Throws with a clear message. */
export function importPayload(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("that file isn't JSON — pick a Nightstand export");
  }
  return migrate(obj);
}
