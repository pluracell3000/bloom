// Nightstand — static feed renderer. No framework, no backend.

import { dayKey, markRead, recordReview, isDue, isRead, unreadState, nextDue } from "./scheduler.mjs";
import { loadState, saveState, exportPayload, importPayload } from "./state.mjs";

const FEED_SCHEMA_VERSION = 1;

const app = document.getElementById("app");
const notices = document.getElementById("notices");

let feed = null;
let state = null;
let openCardId = null;
let revealed = new Set(); // card ids with the answer shown, per render lifetime

const reducedMotion = (() => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return true;
  }
})();

const wait = (ms) => (reducedMotion ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// private feed access (hosted deployments)
//
// The public repo ships only sample cards. On a hosted deployment the real
// feed lives behind /api/feed, which asks for the reader key once. The key is
// stored on this device only. When the API is absent (GitHub Pages, local
// preview) the static ./feed.json is used exactly as before.

const READER_KEY_STORAGE = "nightstand.readerKey";

function getReaderKey() {
  try { return localStorage.getItem(READER_KEY_STORAGE) || ""; } catch { return ""; }
}

function setReaderKey(value) {
  try {
    if (value) localStorage.setItem(READER_KEY_STORAGE, value);
    else localStorage.removeItem(READER_KEY_STORAGE);
  } catch { /* private mode: the gate will ask again next launch */ }
}

function askForReaderKey({ rejected } = {}) {
  return new Promise((resolve) => {
    app.innerHTML = `
      <section class="inner reader-gate">
        <h2>This Nightstand is private</h2>
        <p class="quiet-message">Enter the reader key to open your feed. It stays on this device.</p>
        ${rejected ? `<p class="quiet-message reader-gate-error">That key didn't work. Check it and try again.</p>` : ""}
        <form id="reader-key-form">
          <input id="reader-key-input" type="password" autocomplete="current-password" placeholder="Reader key" required />
          <button type="submit">Open</button>
        </form>
      </section>`;
    const form = document.getElementById("reader-key-form");
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = document.getElementById("reader-key-input").value.trim();
      if (value) resolve(value);
    });
  });
}

async function fetchFeed() {
  for (;;) {
    const key = getReaderKey();
    let apiRes = null;
    try {
      apiRes = await fetch("/api/feed", { headers: key ? { Authorization: `Bearer ${key}` } : {} });
    } catch {
      apiRes = null; // no hosted API here (offline or static hosting)
    }
    if (apiRes && apiRes.status === 401) {
      const hadKey = Boolean(key);
      if (hadKey) setReaderKey("");
      const entered = await askForReaderKey({ rejected: hadKey });
      setReaderKey(entered);
      continue;
    }
    if (apiRes) {
      const contentType = apiRes.headers.get("content-type") || "";
      // A JSON answer (even an error) means the hosted API owns the feed;
      // anything else (e.g. a Pages 404 HTML page) means static mode.
      if (apiRes.ok || contentType.includes("application/json")) return apiRes;
    }
    return fetch("./feed.json");
  }
}

// ---------------------------------------------------------------------------
// boot

async function init() {
  registerServiceWorker();

  const loaded = await loadState();
  state = loaded.state;
  if (loaded.notice === "reset") {
    showResetNotice();
  }

  let res;
  try {
    res = await fetchFeed();
  } catch {
    app.innerHTML = `<p class="quiet-message inner">Can't load the feed — you may be offline. It will be here the next time you open with a connection.</p>`;
    return;
  }
  if (!res.ok) {
    app.innerHTML = `<p class="quiet-message inner">The feed didn't load (HTTP ${res.status}). Pull down to retry, or check back later.</p>`;
    return;
  }
  if (res.headers && res.headers.get && res.headers.get("X-Nightstand-Source") === "cache") {
    addNotice("Offline — showing last synced.");
  }

  let parsed;
  try {
    parsed = await res.json();
  } catch {
    app.innerHTML = `<p class="quiet-message inner">The feed file is damaged. A fresh deploy will fix it — nothing to do on this device.</p>`;
    return;
  }
  if (parsed.schema_version !== FEED_SCHEMA_VERSION) {
    app.innerHTML = `<p class="quiet-message inner">This feed needs a newer app. Close and reopen to update; if that doesn't help, remove and re-add Nightstand from the home screen.</p>`;
    return;
  }

  feed = parsed;
  render();
  wireSettings();
}

function registerServiceWorker() {
  try {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js");
  } catch {
    /* not fatal */
  }
}

// ---------------------------------------------------------------------------
// notices

function addNotice(text) {
  const p = document.createElement("p");
  p.className = "notice";
  p.textContent = text;
  notices.append(p);
}

function showResetNotice() {
  const div = document.createElement("div");
  div.className = "notice-reset";
  div.innerHTML = `<span>State was reset — import a backup?</span>`;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "Import";
  btn.addEventListener("click", () => {
    div.remove();
    openSettings();
  });
  div.append(btn);
  notices.append(div);
}

// ---------------------------------------------------------------------------
// rendering

function cardState(id) {
  return state.cards[id] ?? unreadState();
}

function metaLine(card) {
  const mins = `${card.reading_minutes} min`;
  if (card.source_type === "topic") return `Commissioned · ${mins}`;
  return `${card.source_title} · ${mins}`;
}

function render() {
  const today = dayKey();
  const zoneA = feed.cards.filter((c) => !isRead(cardState(c.id)));
  const zoneB = feed.cards
    .filter((c) => isDue(cardState(c.id), today))
    .sort((a, b) => String(nextDue(cardState(a.id))).localeCompare(String(nextDue(cardState(b.id)))));

  app.innerHTML = `
    <section id="zone-a" aria-label="Fresh">
      <h2 class="sr-only">Fresh</h2>
      <div class="inner" id="zone-a-list"></div>
    </section>
    <div class="horizon" role="separator" aria-label="Caught up">
      <span class="horizon-mark">✦ Caught up</span>
    </div>
    <section id="zone-b" aria-label="Worth a second look">
      <div class="inner">
        <h2 class="zone-b-header">Worth a second look</h2>
        <div id="zone-b-list"></div>
      </div>
    </section>`;

  const aList = app.querySelector("#zone-a-list");
  for (const card of zoneA) aList.append(renderCard(card, "a"));

  const bList = app.querySelector("#zone-b-list");
  if (zoneB.length === 0) {
    bList.innerHTML = `<p class="zone-b-empty">Nothing to revisit today.</p>`;
  } else {
    for (const card of zoneB) bList.append(renderCard(card, "b"));
  }
}

function renderCard(card, zone) {
  const el = document.createElement("article");
  el.className = "card";
  el.dataset.id = card.id;
  el.dataset.zone = zone;

  if (zone === "a") {
    el.innerHTML = `
      <div class="card-preview">
        <h3 class="card-title">${esc(card.title)}</h3>
        <p class="card-meta">${esc(metaLine(card))}</p>
        <ul class="card-tldr">${card.tldr.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>
      </div>
      <div class="card-detail"><div class="card-detail-inner"></div></div>
      <div class="card-actions">
        <button type="button" class="btn btn-quiet open-btn" aria-expanded="false">Open card</button>
        ${doneButtonHtml()}
      </div>`;
    el.querySelector(".card-preview").addEventListener("click", () => toggleCard(el, card));
  } else {
    // Zone B: question-first. The card body is a tap away, never the default.
    el.innerHTML = `
      <div class="recall">
        <p class="recall-question">${esc(card.recall_question)}</p>
        <div class="recall-answer-slot"></div>
        <div class="recall-actions">
          <button type="button" class="btn btn-memory reveal-btn">Reveal</button>
          <button type="button" class="btn btn-quiet open-btn" aria-expanded="false">Open card</button>
        </div>
      </div>
      <div class="card-detail"><div class="card-detail-inner"></div></div>`;
    el.querySelector(".reveal-btn").addEventListener("click", () => reveal(el, card, { withDone: true }));
  }

  el.querySelector(".open-btn").addEventListener("click", () => toggleCard(el, card));
  const done = el.querySelector(".btn-done");
  if (done) done.addEventListener("click", () => onDone(el, card, zone));
  return el;
}

function doneButtonHtml() {
  return `<button type="button" class="btn btn-memory btn-done">Done
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>
  </button>`;
}

function expandedHtml(card) {
  const safeSources = Array.isArray(card.sources)
    ? card.sources.map((value) => ({ value, href: safeHttpUrl(value) })).filter((source) => source.href)
    : [];
  const sourceHref = safeHttpUrl(card.source_url);
  const source =
    card.source_type === "topic"
      ? `<p class="card-sources">Sources<br>${safeSources.map((item) => `<a href="${esc(item.href)}" rel="noopener noreferrer">${esc(item.value)}</a>`).join("<br>")}</p>`
      : sourceHref
        ? `<p class="card-source-link"><a href="${esc(sourceHref)}" rel="noopener noreferrer">${esc(card.source_title)}</a> — ${esc(card.author)}</p>`
        : "";
  return `
    <blockquote class="pull-quote">${esc(card.pull_quote)}</blockquote>
    <div class="card-body">${card.body_html}</div>
    ${source}`;
}

function toggleCard(el, card) {
  const isOpen = el.classList.contains("open");
  const inner = el.querySelector(".card-detail-inner");
  const openBtns = el.querySelectorAll(".open-btn");

  if (isOpen) {
    el.classList.remove("open");
    openBtns.forEach((b) => {
      b.setAttribute("aria-expanded", "false");
      b.textContent = "Open card";
    });
    if (reducedMotion) inner.innerHTML = "";
    else setTimeout(() => { if (!el.classList.contains("open")) inner.innerHTML = ""; }, 300);
    openCardId = null;
    return;
  }

  // Lazy-render the body only when opened.
  const zone = el.dataset.zone;
  let html = expandedHtml(card);
  if (zone === "a") {
    // Expanded Zone A card ends with the recall question.
    html += `
      <div class="recall">
        <p class="recall-question">${esc(card.recall_question)}</p>
        <div class="recall-answer-slot"></div>
        <div class="recall-actions">
          <button type="button" class="btn btn-memory reveal-btn">Reveal</button>
        </div>
      </div>`;
  }
  inner.innerHTML = html;
  const revealBtn = inner.querySelector(".reveal-btn");
  if (revealBtn) revealBtn.addEventListener("click", () => reveal(el, card, { withDone: false, slot: inner }));
  el.classList.add("open");
  openBtns.forEach((b) => {
    b.setAttribute("aria-expanded", "true");
    b.textContent = "Close";
  });
  openCardId = card.id;
}

function reveal(el, card, { withDone, slot = el }) {
  if (revealed.has(card.id + (withDone ? ":b" : ":a"))) return;
  revealed.add(card.id + (withDone ? ":b" : ":a"));

  const slotEl = slot.querySelector(".recall-answer-slot");
  const answer = document.createElement("p");
  answer.className = "recall-answer";
  answer.textContent = card.recall_answer;
  slotEl.append(answer);

  const revealBtn = slot.querySelector(".reveal-btn");
  if (revealBtn) revealBtn.remove();

  if (withDone) {
    // Zone B: Done records the review.
    const actions = el.querySelector(".recall-actions");
    actions.insertAdjacentHTML("afterbegin", doneButtonHtml());
    const done = actions.querySelector(".btn-done");
    done.addEventListener("click", () => onDone(el, card, "b"));
  }

  // Un-blur like ink settling.
  if (reducedMotion) answer.classList.add("revealed");
  else requestAnimationFrame(() => requestAnimationFrame(() => answer.classList.add("revealed")));
}

async function onDone(el, card, zone) {
  const today = dayKey();
  const btn = el.querySelector(".btn-done");
  if (btn) {
    btn.disabled = true;
    btn.classList.add("checking");
  }
  await wait(300); // the check draws itself
  el.classList.add("leaving");
  await wait(250); // the card settles out

  if (zone === "a") {
    state.cards[card.id] = markRead(today);
  } else {
    state.cards[card.id] = recordReview(cardState(card.id), today);
  }
  await saveState(state);
  revealed = new Set();
  openCardId = null;
  render();
}

// ---------------------------------------------------------------------------
// settings sheet: export / import

function openSettings() {
  const dialog = document.getElementById("settings");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function closeSettings() {
  const dialog = document.getElementById("settings");
  if (typeof dialog.close === "function") dialog.close();
  else dialog.removeAttribute("open");
}

function setSettingsMessage(text) {
  document.getElementById("settings-message").textContent = text;
}

function wireSettings() {
  document.getElementById("open-settings").addEventListener("click", () => {
    setSettingsMessage("");
    openSettings();
  });
  document.getElementById("close-settings").addEventListener("click", closeSettings);

  document.getElementById("export-state").addEventListener("click", async () => {
    const { filename, json } = exportPayload(state);
    const file = new File([json], filename, { type: "application/json" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Nightstand state" });
        setSettingsMessage("Exported.");
        return;
      }
    } catch (e) {
      if (e && e.name === "AbortError") return; // user closed the share sheet
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([json], { type: "application/json" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    setSettingsMessage("Downloaded a backup file.");
  });

  const fileInput = document.getElementById("import-file");
  document.getElementById("import-state").addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", async () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      state = importPayload(text);
      await saveState(state);
      revealed = new Set();
      render();
      setSettingsMessage("Imported — your reading state is back.");
    } catch (e) {
      setSettingsMessage(`Import failed: ${e.message}. Pick a Nightstand export file.`);
    } finally {
      fileInput.value = "";
    }
  });
}

// ---------------------------------------------------------------------------

window.__nightstandReady = init();
