// SPDX-License-Identifier: AGPL-3.0-only
// App: UI, player, storage, PDF loading, document view, checks. Moved from index.html (lines 761-2003).
import {
  F, ALNUM, HAS_ALNUM, SEG, graphemes, isAlnum,
  ABBR, pivotOf, pivotIndex, flagsOf, FACTOR, setSentenceFactor,
  factorOf, cutRun, tokenize, buildPage, sentenceStart, rewindTarget,
  prevSentence, nextSentence, Book, extractLines, ROMAN, lineSig,
  lowerBound, romanValue, applyCleanup, mulM, findImageBoxes, placeImages, viewportRect, textQuality
} from './core.js';
import { sanitizeSettings, parsePositionsExport } from './settings.js';
import { openDatabase } from './storage.js';
import { zipParts, crc32Update, libraryManifest, readEnd, readCentral, checkLocal, parseLibraryManifest, BACKUP } from './backup.js';

// Developer panels are shown only with ?dev in the address.
if (new URLSearchParams(location.search).has('dev')) document.documentElement.classList.add('dev');


/* ===== Scheduler: deadline-based, no drift accumulation ===== */
class Player {
  constructor(o) { Object.assign(this, { count: () => 0, factor: () => 1, seek: i => i, idx: 0, wpm: 300, playing: false, timer: 0, nextAt: 0 }, o); }
  dur(i) { return 60000 / this.wpm * this.factor(i); }
  play(from) {
    const n = this.count(); if (!n) return;
    this.idx = this.seek(Math.max(0, Math.min(from, n - 1)));
    this.playing = true;
    this.onShow(this.idx);
    this.nextAt = performance.now() + this.dur(this.idx) * 1.5;   // short lead-in on the first word
    this.onState && this.onState();
    this.arm();
  }
  arm() { clearTimeout(this.timer); this.timer = setTimeout(() => this.tick(), Math.max(0, this.nextAt - performance.now())); }
  tick() {
    if (!this.playing) return;
    if (this.onLate && performance.now() - this.nextAt > 1000) { this.onLate(); return; }   // throttled = page not in front
    const next = this.seek(this.idx + 1);
    const gate = this.gate && next < this.count() ? this.gate(this.idx, next) : null;
    if (gate) { this.playing = false; clearTimeout(this.timer); this.onGate(gate, next); this.onState && this.onState(); return; }
    if (next >= this.count() || next <= this.idx) { this.playing = false; this.onFinish && this.onFinish(); this.onState && this.onState(); return; }
    this.idx = next;
    this.onShow(next);
    // Keep the long-run pace exact by absorbing small timer jitter, but never show a word for less than 85% of
    // its time: after a browser stall, the lost time is dropped instead of being made up with flashing words.
    const now = performance.now(), d = this.dur(next);
    this.nextAt = Math.max(this.nextAt + d, now + d * 0.85);
    this.arm();
  }
  pause() { if (!this.playing) return; this.playing = false; clearTimeout(this.timer); this.onState && this.onState(); }
}

/* ===== Storage: IndexedDB for books, localStorage for small settings ===== */
// PROCESSOR_VERSION 5: N1 page-number rule and the language-independent garbled check; older books are re-read once.
const DB_NAME = 'rsvp-reader', PROCESSOR_VERSION = 5;   // schema versions live in src/storage.js (MIGRATIONS)
let dbPromise = null;
function db() {
  if (!dbPromise) dbPromise = openDatabase(DB_NAME, {
    onBlocked: () => showMsg('', 'Close the other tabs of this app to finish updating your library.'),
    onVersionChange: () => { dbPromise = null; showMsg('err', 'A newer version of the app was opened in another tab. Reload this tab.'); },
  }).then(({ db: d, newer }) => {
    if (newer) showMsg('', 'Your library was saved by a newer version of the app. Reload when you can to get the update.');
    return d;
  }).catch(e => { dbPromise = null; throw e; });
  return dbPromise;
}
const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const txDone = t => new Promise((res, rej) => { t.oncomplete = () => res(); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error || new DOMException('Aborted', 'AbortError')); });
const pageRange = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);
async function idbGet(store, key) { const d = await db(); return reqP(d.transaction(store).objectStore(store).get(key)); }
async function idbAll(store, range) { const d = await db(); return reqP(d.transaction(store).objectStore(store).getAll(range)); }
async function idbPut(store, val) { const d = await db(); const t = d.transaction(store, 'readwrite'); t.objectStore(store).put(val); return txDone(t); }
async function deleteBook(id) {
  const d = await db();
  const t = d.transaction(['documents', 'files', 'pages', 'progress'], 'readwrite');
  t.objectStore('documents').delete(id); t.objectStore('files').delete(id);
  t.objectStore('progress').delete(id); t.objectStore('pages').delete(pageRange(id));
  return txDone(t);
}
async function cleanOrphans() {
  const d = await db();
  const docs = new Set(await reqP(d.transaction('documents').objectStore('documents').getAllKeys()));
  const keys = await reqP(d.transaction('pages').objectStore('pages').getAllKeys());
  const orphan = new Set(keys.map(k => k[0]).filter(id => !docs.has(id)));
  for (const id of orphan) { const t = d.transaction('pages', 'readwrite'); t.objectStore('pages').delete(pageRange(id)); await txDone(t); }
  return orphan.size;
}
function settings(get, val) {
  try {
    if (get) return JSON.parse(localStorage.getItem('rsvp-settings') || localStorage.getItem('rsvp-m1') || 'null') || {};
    const cur = JSON.parse(localStorage.getItem('rsvp-settings') || '{}');
    localStorage.setItem('rsvp-settings', JSON.stringify(Object.assign(cur, val)));
  } catch (e) { return {}; }
}
// Stored settings are re-validated whenever they are applied; invalid values (from older versions or an import)
// are replaced by their clamped value or removed, both in the result and in storage (SEC-03).
function validSettings() {
  let out = settings(true);
  if (!out || typeof out !== 'object' || Array.isArray(out)) {          // storage holds something that is not settings
    try { localStorage.setItem('rsvp-settings', '{}'); } catch (e) {}
    return {};
  }
  const clean = sanitizeSettings(out);
  const bad = ['wpm', 'sent', 'skipRunning', 'showImages'].filter(k => k in out && out[k] !== clean[k]);
  if (!bad.length) return out;
  for (const k of bad) { if (k in clean) out[k] = clean[k]; else delete out[k]; }
  try { localStorage.setItem('rsvp-settings', JSON.stringify(out)); } catch (e) {}
  return out;
}

/* ===== pdf.js loading: always the vendored copy from this origin (no CDN; CONTROLS.md PRV-04) ===== */
// pdf.js 6 (legacy build) is an ES module; it is loaded on first use so the reader starts without it.
let pdfjsLib = null, pdfjsPromise = null, workerMode = '';
const PDFJS_WASM = new URL('vendor/pdfjs/wasm/', location.href).href;   // JPEG 2000, JBIG2 and ICC decoders
// pdf.js 6 needs Chrome 125+, Safari/iOS 18+ or a current Firefox (docs/adr/0005). The text layer relies on CSS round();
// checking for it catches the browsers that are too old before anything fails half-way.
const OLD_BROWSER = 'This browser is too old to open PDFs. Update Chrome (version 125 or newer), Safari (iOS 18 or newer) or Firefox, then reload.';
function pdfSupported() {
  try { return typeof Worker === 'function' && typeof WebAssembly === 'object' && CSS.supports('width', 'round(down, 10px, 1px)'); }
  catch (e) { return false; }
}
function ensurePdfjs() {
  if (!pdfjsPromise) pdfjsPromise = (async () => {
    if (!pdfSupported()) throw userError(OLD_BROWSER);
    let lib;
    try { lib = await import('../vendor/pdfjs/pdf.min.mjs'); }
    catch (e) { console.warn('pdf.js failed to load', e); throw userError(OLD_BROWSER); }
    lib.GlobalWorkerOptions.workerSrc = new URL('vendor/pdfjs/pdf.worker.min.mjs', location.href).href;
    pdfjsLib = lib;
    workerMode = 'background worker';
  })().catch(e => { pdfjsPromise = null; throw e; });
  return pdfjsPromise;
}

/* ===== UI ===== */
const $ = id => document.getElementById(id);
const reader = $('reader'), stage = $('stage'), row = $('row'), pre = $('pre'), piv = $('piv'), post = $('post');
const SAMPLE = `Rapid serial visual presentation shows you one word at a time. Your eyes stay still and the words come to you. This sample lets you test the reader without a PDF.

Watch the red letter. It should never move, whether the word is short, like "a" or "it", or long, like "incomprehensibilities". Punctuation adds a small pause: a comma gives you a breath, and a full stop gives you a longer one.

The tokenizer has to handle awkward cases. Don't worry about contractions; they stay whole, and so does my mother-in-law's favourite phrase. Abbreviations such as the U.S. or e.g. should not trigger a sentence pause, and numbers like 3.14 or $1,250 stay in one piece. A dash splits two words—like this—into separate units. Even a link, https://example.com, is shown as one unit and shrinks if it does not fit.

Now try the controls. Tap or press Space to pause. Step back or forward a sentence with the arrow keys, and change the speed with up and down. When you resume, the reader returns to the start of the sentence you were in, so you never lose the thread.`;

let book = null, suffix = new Float64Array(1), finished = false, testing = false, lastSave = 0, wake = null;
let W = 0, anchorX = 0, base = 48;
const MARGIN = 14;
const player = new Player({
  count: () => book ? book.length : 0,
  factor: i => book.factor(i),
  seek: i => { let j = i; while (j < book.length && book.flags[j] & F.SKIP) j++; return j; },
  onShow: i => { render(book.text(i)); shownLog.push([performance.now(), i]); if (shownLog.length > 60) shownLog.shift(); onWordShown(); },
  onState: () => updateUI(),
  onFinish: () => { finished = true; releaseWake(); saveProgress(); },
  onLate: () => pauseBackground('a timer fired more than 1 s late (treated as a background tab)'),
  gate: (a, b) => imageBetween(a, b),
  onGate: (img, next) => showImage(img, next)
});
const shownLog = [];
// Android reports a locked screen up to ~1 s late, so words keep flashing unseen.
// On a background pause, step back to the word that was on screen 1.5 s earlier.
// Why playback last stopped, for diagnostics in the acceptance checks (shown when a check fails).
let lastStop = null;
function noteStop(reason) { lastStop = { reason, t: performance.now() }; }
function pauseBackground(reason) {
  if (player.playing) noteStop(reason || 'background');
  cancelPendingStart();
  if (!player.playing) return;
  const cutoff = performance.now() - 1500;
  let back = shownLog.length ? shownLog[0][1] : null;
  for (let k = shownLog.length - 1; k >= 0; k--) if (shownLog[k][0] <= cutoff) { back = shownLog[k][1]; break; }
  player.pause(); releaseWake();
  if (back != null && back < player.idx) { player.idx = back; render(book.text(back)); updateUI(); }
  saveProgress();
}

function measureStage() {
  W = stage.clientWidth;
  anchorX = W * 0.38;
  base = Math.max(32, Math.min(62, W * 0.058));
  stage.style.setProperty('--band', Math.round(base * 1.05) + 'px');
}

function render(text) {
  if (text == null) { pre.textContent = ''; piv.textContent = ''; post.textContent = ''; return; }
  const ch = graphemes(text), p = pivotOf(ch).p;
  pre.textContent = ch.slice(0, p).join('');
  piv.textContent = ch[p] || '';
  post.textContent = ch.slice(p + 1).join('');
  // Measure at full size with no transform, then shrink with a CSS scale around the pivot.
  // A scale cannot be blocked by a browser's minimum font size setting; a smaller font-size can.
  row.style.fontSize = base + 'px';
  row.style.transform = 'none';
  const rr = row.getBoundingClientRect(), pr = piv.getBoundingClientRect();
  const left = pr.left - rr.left + pr.width / 2, right = rr.width - left;
  const s = Math.min(1, (anchorX - MARGIN) / left, (W - anchorX - MARGIN) / right);
  row.style.transformOrigin = `${left}px 50%`;
  row.style.transform = `translate(${anchorX - left}px, -50%)` + (s < 1 ? ` scale(${s * 0.98})` : '');
}

function fmtTime(ms) {
  const min = Math.round(ms / 60000);
  if (ms < 60000) return 'under 1 min left';
  if (min < 60) return `${min} min left`;
  return `${Math.floor(min / 60)} h ${min % 60} min left`;
}
const fmtN = n => n.toLocaleString('en');
let visibleCount = 0;
function buildSuffix() {
  const n = book ? book.length : 0;
  suffix = new Float64Array(n + 1);
  visibleCount = 0;
  for (let i = n - 1; i >= 0; i--) { const f = book.factor(i); suffix[i] = suffix[i + 1] + f; if (f > 0) visibleCount++; }
}
function updateUI() {
  const playing = player.playing, n = book ? book.length : 0, i = player.idx;
  reader.classList.toggle('playing', playing);
  $('stateLabel').textContent = testing ? 'Checking' : playing ? '' : starting ? 'Starting' : imageMode ? '' : finished ? 'Finished' : 'Paused';
  $('playBtn').textContent = imageMode ? 'Continue' : finished ? 'Restart' : (i > 0 ? 'Resume' : 'Play');
  $('titleLabel').textContent = book ? book.title : '';
  $('fill').style.width = n ? ((i + 1) / n * 100).toFixed(2) + '%' : '0';
  let meta = 'Nothing to read yet. Add a PDF or paste text below.';
  if (n) {
    const pages = book.pages.length;
    const where = pages > 1 ? `p. ${book.pageOf(i) + 1} / ${pages}` : `word ${fmtN(i + 1)} / ${fmtN(n)}`;
    meta = `${Math.floor((i + 1) / n * 100)}% · ${where} · ${fmtTime(suffix[i] * 60000 / player.wpm)}`;
  }
  $('meta').textContent = meta;
  $('wpmOut').textContent = $('wpmLabel').textContent = `${player.wpm} wpm`;
  const b = 60000 / player.wpm;
  let pace = '';
  if (n && visibleCount && suffix[0]) pace = ` · with pauses this text reads at about ${Math.round(player.wpm * visibleCount / suffix[0])} wpm`;
  $('pauseNote').textContent = `At ${player.wpm} wpm: word ${Math.round(b)} ms · sentence end ${Math.round(b * FACTOR.sent)} ms · paragraph end ${Math.round(b * FACTOR.para)} ms${pace}`;
  $('sentPause').disabled = testing;
  for (const id of ['backBtn', 'fwdBtn', 'playBtn', 'slower', 'faster']) $(id).disabled = testing || !n;
  $('docBtn').disabled = testing || !n || !book.id;
  if (!playing) docRefreshPos();
  for (const id of ['checkBtn', 'timeBtn', 'loadBtn']) $(id).disabled = testing;
}
function onWordShown() {
  $('fill').style.width = ((player.idx + 1) / book.length * 100).toFixed(2) + '%';
  if (performance.now() - lastSave > 5000) saveProgress();
}

function saveProgress() {
  lastSave = performance.now();
  if (!book) return;
  if (book.id) {
    idbPut('progress', { docId: book.id, tokenIndex: player.idx, updatedAt: Date.now() }).then(() => {
      const r = libRows.get(book.id); if (r) r.progress = { tokenIndex: player.idx, updatedAt: Date.now() };
    }).catch(() => {});
  } else settings(false, { textIdx: player.idx });
}

async function requestWake() { try { if ('wakeLock' in navigator && !wake) { wake = await navigator.wakeLock.request('screen'); wake.addEventListener('release', () => { wake = null; }); } } catch (e) { wake = null; } }
function releaseWake() { try { wake && wake.release(); } catch (e) {} wake = null; }

// Reading stops when the reader is scrolled out of view: words changing off-screen are words not read.
// Focus mode covers the whole screen, so it never triggers this.
let readerVisible = true;
new IntersectionObserver(([e]) => {
  readerVisible = e.intersectionRatio >= 0.5;
  if (!readerVisible && player.playing && !reader.classList.contains('focus')) pause('reader scrolled out of view');
}, { threshold: [0, 0.5, 1] }).observe(reader);

function start(exact, keepShown) {
  if (!book || !book.length || testing) return;
  if (!readerVisible && !reader.classList.contains('focus')) reader.scrollIntoView({ block: 'nearest' });
  hideImage();
  if (!keepShown) justShown.clear();
  // an automatic resume rewinds a few words: do not show again an image already passed
  suppressBefore = exact != null || finished ? -1 : player.idx;
  const from = exact != null ? exact : finished ? 0 : rewindTarget(book.flags, player.idx);
  finished = false;
  shownLog.length = 0;
  requestWake();
  player.play(from);
}
function pause(reason) { cancelPendingStart(); if (!player.playing) return; noteStop(reason || 'paused'); player.pause(); releaseWake(); saveProgress(); }
function step(fn) {
  if (!book || !book.length || testing) return;
  pause(); hideImage(); finished = false;
  player.idx = book.visible(fn(book.flags, player.idx));
  render(book.text(player.idx)); updateUI(); saveProgress();
}
function setWpm(d) { player.wpm = Math.max(100, Math.min(1000, player.wpm + d)); settings(false, { wpm: player.wpm }); updateUI(); }

function setBook(b, idx) {
  pause('a book was opened'); hideImage();
  suppressBefore = -1; justShown.clear();
  book = b;
  player.idx = b.length ? b.visible(Math.max(0, Math.min(idx || 0, b.length - 1))) : 0;
  finished = false;
  buildSuffix();
  render(b.length ? b.text(player.idx) : null);
  updateUI();
  renderLibrary();
  docOpen(b);
}

function loadPastedText(text, idx) {
  const b = new Book({ title: 'Pasted text' }, [buildPage(text.replace(/\r\n?/g, '\n'), true)]);
  setBook(b, idx);
  $('srcNote').textContent = b.length ? `${fmtN(b.length)} words` : 'No words found in this text.';
  settings(false, { current: { kind: 'text' }, text, textIdx: player.idx });
}

function applySentence(v) {
  setSentenceFactor(v);
  $('sentPause').value = v;
  $('sentOut').textContent = v + '×';
  buildSuffix();
  settings(false, { sent: v });
  updateUI();
}
$('sentPause').addEventListener('input', e => applySentence(+e.target.value));
function skipRunningSetting() { const v = settings(true).skipRunning; return v !== false; }
$('skipRun').addEventListener('change', e => {
  settings(false, { skipRunning: e.target.checked });
  if (book && book.id) { const g = player.idx, cur = book; setBook(new Book(cur.meta, cur.pages, { skipRunning: e.target.checked }), g); }
});

function setFocus(on) {
  reader.classList.toggle('focus', on);
  $('focusBtn').textContent = on ? 'Exit focus' : 'Focus';
  try {
    if (on && reader.requestFullscreen && !document.fullscreenElement) reader.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) {}
}
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && reader.classList.contains('focus')) { reader.classList.remove('focus'); $('focusBtn').textContent = 'Focus'; } });

reader.addEventListener('click', e => {
  if (testing) return;
  if (e.target.closest('button, input, output')) return;   // buttons have their own handlers
  if (cancelPendingStart()) return;
  if (imageMode) { continueImage(); return; }
  if (player.playing) { pause(); return; }
  start();
});
$('playBtn').onclick = () => imageMode ? continueImage() : start();
$('backBtn').onclick = () => step(prevSentence);
$('fwdBtn').onclick = () => step(nextSentence);
$('slower').onclick = () => setWpm(-25);
$('faster').onclick = () => setWpm(25);
$('focusBtn').onclick = () => setFocus(!reader.classList.contains('focus'));
$('loadBtn').onclick = () => { loadPastedText($('src').value, 0); reader.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
$('sampleBtn').onclick = () => { $('src').value = SAMPLE; loadPastedText(SAMPLE, 0); };

document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('textarea, input')) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key;
  if (imageMode && (k === 'Enter' || k === ' ')) { e.preventDefault(); continueImage(); return; }
  if (k === ' ' || k === 'Spacebar') { e.preventDefault(); if (testing) return; imageMode ? continueImage() : player.playing ? pause() : start(); }
  else if (k === 'ArrowLeft') { e.preventDefault(); step(prevSentence); }
  else if (k === 'ArrowRight') { e.preventDefault(); step(nextSentence); }
  else if (k === 'ArrowUp') { e.preventDefault(); setWpm(25); }
  else if (k === 'ArrowDown') { e.preventDefault(); setWpm(-25); }
  else if (k === 'f' || k === 'F') setFocus(!reader.classList.contains('focus'));
  else if (k === 'Escape') { if (imageMode) continueImage(); else setFocus(false); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { if (player.playing) pauseBackground('page hidden'); else saveProgress(); if (testing && testPlayer) testPlayer.abort(); }
});
window.addEventListener('pagehide', () => { if (player.playing) pauseBackground('page hide'); else saveProgress(); });
window.addEventListener('blur', () => { if (player.playing) pauseBackground('window lost focus'); });       // switched to another window or app
document.addEventListener('freeze', () => { if (player.playing) pauseBackground('page frozen'); });   // Android may freeze background pages

/* ===== Library ===== */
let libRows = new Map(), dbOk = true;
const MB = 1024 * 1024;

function showMsg(kind, text) { const m = $('libMsg'); m.hidden = !text; m.className = 'msg ' + (kind || ''); m.textContent = text || ''; }

async function refreshLibrary() {
  if (!dbOk) return;
  try {
    const [docs, progs] = await Promise.all([idbAll('documents'), idbAll('progress')]);
    const pm = new Map(progs.map(p => [p.docId, p]));
    libRows = new Map(docs.map(d => [d.id, { doc: d, progress: pm.get(d.id) || null }]));
  } catch (e) { libRows = new Map(); }
  renderLibrary();
  storageNote();
}
function renderLibrary() {
  const ul = $('books');
  ul.textContent = '';
  if (!dbOk) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'This browser does not allow local storage here, so PDFs cannot be saved. Private windows often block it.'; ul.appendChild(li); return; }
  const rows = [...libRows.values()].sort((a, b) => Math.max(b.doc.createdAt, b.progress ? b.progress.updatedAt : 0) - Math.max(a.doc.createdAt, a.progress ? a.progress.updatedAt : 0));
  if (!rows.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'No books yet. Add a PDF with a text layer, for example an ebook exported to PDF.'; ul.appendChild(li); return; }
  for (const { doc, progress } of rows) {
    const li = document.createElement('li');
    li.className = 'book' + (book && book.id === doc.id ? ' current' : '');
    const pct = progress && doc.totalTokens ? Math.floor((progress.tokenIndex + 1) / doc.totalTokens * 100) : 0;
    const t = document.createElement('div'); t.className = 't'; t.textContent = doc.title; t.title = doc.fileName || doc.title;
    const m = document.createElement('div'); m.className = 'm';
    const perPage = doc.importMs && doc.pageCount ? ` · imported in ${(doc.importMs / 1000).toFixed(1)} s (${Math.round(doc.importMs / doc.pageCount)} ms/page)` : '';
    m.textContent = `${fmtN(doc.pageCount)} pages · ${fmtN(doc.totalTokens)} words · ${pct}%${perPage}`;
    const acts = document.createElement('div'); acts.className = 'acts';
    const open = document.createElement('button'); open.className = 'btn small'; open.type = 'button';
    const isCur = book && book.id === doc.id;
    open.textContent = isCur ? 'Open' : (pct > 0 ? 'Continue' : 'Read');
    open.disabled = isCur;
    open.onclick = () => openBook(doc.id, true);
    const del = document.createElement('button'); del.className = 'btn small'; del.type = 'button'; del.textContent = 'Delete';
    let armed = 0;
    del.onclick = async () => {
      if (!armed) { del.textContent = 'Confirm delete'; del.classList.add('danger'); armed = setTimeout(() => { armed = 0; del.textContent = 'Delete'; del.classList.remove('danger'); }, 4000); return; }
      clearTimeout(armed);
      del.disabled = true;
      if (book && book.id === doc.id) { pause(); book = null; buildSuffix(); render(null); docClose(); updateUI(); settings(false, { current: null }); }
      try { await deleteBook(doc.id); showMsg('', `Deleted “${doc.title}”.`); } catch (e) { showMsg('err', 'Could not delete the book: ' + (e.message || e)); }
      refreshLibrary();
    };
    acts.append(open, del);
    const bar = document.createElement('div'); bar.className = 'bar'; const bi = document.createElement('i'); bi.style.width = pct + '%'; bar.appendChild(bi);
    li.append(t, acts, m);
    const warns = [];
    if (doc.emptyPages && doc.emptyPages.length) warns.push(`${doc.emptyPages.length} page${doc.emptyPages.length > 1 ? 's' : ''} had no text and ${doc.emptyPages.length > 1 ? 'were' : 'was'} skipped (p. ${doc.emptyPages.slice(0, 8).join(', ')}${doc.emptyPages.length > 8 ? ', …' : ''})`);
    if (doc.garbled) warns.push('The text in this PDF looks garbled. Check a few words before reading.');
    if (warns.length) { const w = document.createElement('div'); w.className = 'w'; w.textContent = warns.join(' · '); li.appendChild(w); }
    if (doc.cleanup) {
      const c = document.createElement('div'); c.className = 'm c';
      const parts = doc.cleanup.removed.map(r => `“${r.text}” (${r.pages} pages)`);
      const ni = (doc.images || []).length;
      c.textContent = (parts.length ? `Skipped as headers or footers: ${parts.join(', ')}` : 'No running headers or page numbers found') + ` · ${fmtN(doc.cleanup.paras)} paragraph breaks · ${ni} image${ni === 1 ? '' : 's'}` + (ni ? ` (p. ${[...new Set(doc.images.map(im => im.p + 1))].slice(0, 10).join(', ')}${ni > 10 ? ', …' : ''})` : '');
      li.appendChild(c);
    }
    li.appendChild(bar);
    ul.appendChild(li);
  }
}
async function storageNote() {
  try {
    if (!navigator.storage || !navigator.storage.estimate) return;
    const e = await navigator.storage.estimate();
    $('storageNote').textContent = `Using ${(e.usage / MB).toFixed(1)} MB of about ${(e.quota / MB / 1024).toFixed(1)} GB available to this page.`;
  } catch (e) {}
}

async function openBook(id, scroll) {
  try {
    pause();
    const [doc, pages, prog] = await Promise.all([idbGet('documents', id), idbAll('pages', pageRange(id)), idbGet('progress', id)]);
    if (!doc) { showMsg('err', 'That book is no longer in the library.'); refreshLibrary(); return; }
    if ((doc.processorVersion || 1) < PROCESSOR_VERSION) {
      try { await reprocessBook(doc); } catch (e) { showMsg('err', 'Could not update this book: ' + (e.message || e)); return; }
      refreshLibrary();
      return openBook(id, scroll);
    }
    if (pages.length !== doc.pageCount) { showMsg('err', `This book is incomplete (${pages.length} of ${doc.pageCount} pages stored). Delete it and add the PDF again.`); return; }
    pages.sort((a, b) => a.pageIndex - b.pageIndex);
    setBook(new Book({ id, title: doc.title, pageSizes: doc.pageSizes, images: doc.images || [] }, pages, { skipRunning: skipRunningSetting() }), prog ? prog.tokenIndex : 0);
    settings(false, { current: { kind: 'doc', id } });
    if (scroll) reader.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  } catch (e) { showMsg('err', 'Could not open the book: ' + (e.message || e)); }
}


async function sha256Hex(buf) {
  try { const h = await crypto.subtle.digest('SHA-256', buf); return Array.from(new Uint8Array(h), b => b.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return null; }
}

// Read every page, tokenize, then clean up across the whole book (headers repeat across pages).
async function processPdf(pdf, id, me, onPage) {
  const total = pdf.numPages, pageSizes = [], empty = [], failed = [], pdata = [];
  let tokens = 0;
  const sample = [];                                    // words for the garbled-text check (N2)
  for (let i = 0; i < total; i++) {
    if (me.cancelled) throw cancelError();
    let ex = { text: '', itemStarts: [], lines: [] }, size = [0, 0], ph = 0, view = [0, 0, 0, 0], boxes = [];
    try {
      const page = await pdf.getPage(i + 1);
      const vp = page.getViewport({ scale: 1 }); size = [vp.width, vp.height];
      const v = page.view; ph = v[3] - v[1];
      const tc = await page.getTextContent();
      ex = extractLines(tc.items);
      ex.lines.forEach(l => { l.y -= v[1]; l.x0 -= v[0]; l.x1 -= v[0]; });
      view = v;
      try { const ops = await page.getOperatorList(); boxes = findImageBoxes(ops.fnArray, ops.argsArray, pdfjsLib.OPS); } catch (e) { boxes = []; }
      page.cleanup();
    } catch (e) { failed.push(i + 1); }
    pageSizes.push(size);
    const rec = buildPage(ex.text, false);
    if (((ex.text.match(/\p{L}/gu) || []).length) < 20) empty.push(i + 1);
    for (let j = 0; j < rec.tokStart.length && j < 400 && sample.length < 20000; j++)
      sample.push(rec.over[j] != null ? rec.over[j] : ex.text.slice(rec.tokStart[j], rec.tokEnd[j]));
    tokens += rec.tokStart.length;
    rec.docId = id; rec.pageIndex = i; rec.itemStarts = Uint32Array.from(ex.itemStarts);
    pdata.push({ rec, lines: ex.lines, ph, view, boxes, letters: (ex.text.match(/\p{L}/gu) || []).length });
    if (i === 29 && empty.length === 30) break;   // first 30 pages have no text: stop early
    onPage && onPage(i, total, tokens);
    if (i % 8 === 7) await new Promise(r => setTimeout(r, 0));   // keep the page responsive
  }
  const scanned = pageSizes.length < total ? true : empty.length > total / 2;
  const cleanup = scanned ? null : applyCleanup(pdata);
  const images = scanned ? [] : placeImages(pdata);
  pdata.forEach(pd => { delete pd.lines; delete pd.boxes; });
  const withImage = new Set(images.map(im => im.p + 1));
  return { pdata, total, tokens, pageSizes, empty: empty.filter(n => !withImage.has(n)), failed, scanned, cleanup, images, garbled: textQuality(sample).garbled };
}
async function savePages(pdata, onFirst) {
  const d = await db();
  for (let i = 0; i < pdata.length; i += 40) {
    const t = d.transaction('pages', 'readwrite'), st = t.objectStore('pages');
    for (const pd of pdata.slice(i, i + 40)) st.put(pd.rec);
    await txDone(t);
    if (i === 0) onFirst && onFirst();
  }
}

// Books imported before the cleanup existed are re-read once from the stored PDF. Word positions do not change.
async function reprocessBook(doc) {
  if (job) throw userError('Wait for the current import to finish.');
  const me = job = { cancelled: false, t0: performance.now() };
  const box = $('importBox'); box.hidden = false;
  $('importName').textContent = `Updating “${doc.title}”: headers, paragraphs and images`;
  $('importFill').style.width = '0'; $('importMeta').textContent = 'Opening PDF…'; $('cancelBtn').hidden = true;
  let pdf = null;
  try {
    const [rec] = await Promise.all([idbGet('files', doc.id), ensurePdfjs()]);
    if (!rec || !rec.blob) throw userError('The PDF file for this book is missing. Delete the book and add it again.');
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await rec.blob.arrayBuffer()), wasmUrl: PDFJS_WASM, useSystemFonts: true, stopAtErrors: false }).promise;
    const r = await processPdf(pdf, doc.id, me, (i, total) => {
      $('importFill').style.width = ((i + 1) / total * 100).toFixed(1) + '%';
      $('importMeta').textContent = `Page ${fmtN(i + 1)} / ${fmtN(total)}`;
    });
    $('importMeta').textContent = 'Saving…';
    await savePages(r.pdata);
    Object.assign(doc, { totalTokens: r.tokens, cleanup: r.cleanup, images: r.images, emptyPages: r.empty, garbled: r.garbled, processorVersion: PROCESSOR_VERSION });
    await idbPut('documents', doc);
  } finally {
    if (pdf) { try { pdf.destroy(); } catch (e) {} }
    box.hidden = true; $('cancelBtn').hidden = false; job = null;
  }
}

let job = null;
// batch (restoring a backup): no messages and no opening of the book; returns { status, id, title, message, quota, cancelled }.
async function importPdf(file, { batch = false } = {}) {
  const fail = (message) => { if (!batch) showMsg('err', message); return { status: 'error', message }; };
  if (job) return fail('Wait for the current import to finish, or cancel it.');
  if (!dbOk) return fail('Local storage is not available in this browser window, so PDFs cannot be saved.');
  if (!batch) showMsg('', '');
  if (!/\.pdf$/i.test(file.name) && file.type !== 'application/pdf') return fail(`“${file.name}” is not a PDF. Only PDF files are supported.`);
  if (file.size > 200 * MB) return fail(`This file is ${(file.size / MB).toFixed(0)} MB. The limit is 200 MB.`);

  const me = job = { cancelled: false, t0: performance.now() };
  const box = $('importBox'); box.hidden = false;
  $('importName').textContent = file.name; $('importFill').style.width = '0'; $('importMeta').textContent = 'Reading file…';
  $('addBtn').disabled = true;
  let id = null, pdf = null, wrotePages = false;
  const finish = () => { box.hidden = true; $('addBtn').disabled = false; job = null; };
  const rollback = async () => { if (id && wrotePages) { try { const d = await db(); const t = d.transaction('pages', 'readwrite'); t.objectStore('pages').delete(pageRange(id)); await txDone(t); } catch (e) {} } };
  try {
    const buf = await file.arrayBuffer();
    const head = new Uint8Array(buf, 0, Math.min(1024, buf.byteLength));
    if (!String.fromCharCode.apply(null, head).includes('%PDF-')) throw userError(`“${file.name}” is not a valid PDF file.`);
    id = (await sha256Hex(buf)) || `${file.name}|${file.size}|${file.lastModified}`;
    const existing = await idbGet('documents', id);
    if (existing) { finish(); if (batch) return { status: 'exists', id, title: existing.title }; showMsg('', `“${existing.title}” is already in your library. Opened it.`); openBook(id, true); return; }

    $('importMeta').textContent = 'Loading the PDF engine…';
    await ensurePdfjs();
    if (me.cancelled) throw cancelError();
    $('importMeta').textContent = 'Opening PDF…';
    try {
      pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buf), wasmUrl: PDFJS_WASM, useSystemFonts: true, stopAtErrors: false }).promise;
    } catch (e) {
      if (e && e.name === 'PasswordException') throw userError('This PDF is password-protected. Password-protected PDFs are not supported yet.');
      throw userError('This PDF is damaged or uses a format the reader cannot open.');
    }
    let title = file.name.replace(/\.pdf$/i, '');
    try { const md = await pdf.getMetadata(); const t = md && md.info && md.info.Title ? String(md.info.Title).trim().replace(/^Microsoft Word - /, '') : ''; if (t.length > 2 && !/^untitled/i.test(t)) title = t; } catch (e) {}

    const r = await processPdf(pdf, id, me, (i, total, tokens) => {
      $('importFill').style.width = ((i + 1) / total * 100).toFixed(1) + '%';
      $('importMeta').textContent = `Page ${fmtN(i + 1)} / ${fmtN(total)} · ${fmtN(tokens)} words`;
    });
    if (r.scanned) throw userError('This PDF has no text layer (it looks scanned). Scanned PDFs are not supported.');
    if (!r.tokens) throw userError('No readable text was found in this PDF.');
    $('importMeta').textContent = 'Saving…';
    await savePages(r.pdata, () => { wrotePages = true; });
    const total = r.total, tokens = r.tokens, failed = r.failed;
    const doc = {
      id, title, fileName: file.name, sizeBytes: file.size, pageCount: total, pageSizes: r.pageSizes,
      totalTokens: tokens, emptyPages: r.empty, failedPages: failed, garbled: r.garbled, cleanup: r.cleanup, images: r.images,
      processorVersion: PROCESSOR_VERSION, engine: workerMode, createdAt: Date.now(),
      importMs: Math.round(performance.now() - me.t0)
    };
    const d = await db();
    const t = d.transaction(['files', 'documents'], 'readwrite');
    t.objectStore('files').put({ docId: id, blob: file });
    t.objectStore('documents').put(doc);
    await txDone(t);
    try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) {}
    finish();
    if (batch) return { status: 'added', id, title };
    showMsg('ok', `Added “${title}”: ${fmtN(total)} pages, ${fmtN(tokens)} words, ${(doc.importMs / 1000).toFixed(1)} s.` + (failed.length ? ` ${failed.length} page(s) could not be read.` : ''));
    await refreshLibrary();
    openBook(id, true);
  } catch (e) {
    await rollback();
    finish();
    const quota = !!(e && (e.name === 'QuotaExceededError' || /quota/i.test(e.message || '')));
    let message;
    if (e && e.cancelled) message = 'Import cancelled. Nothing was saved.';
    else if (e && e.user) message = e.message;
    else if (quota) {
      let extra = ''; try { const est = await navigator.storage.estimate(); extra = ` This page can use about ${(est.quota / MB).toFixed(0)} MB and already uses ${(est.usage / MB).toFixed(0)} MB.`; } catch (x) {}
      message = 'Not enough storage space for this book. Delete a book and try again.' + extra;
    }
    else if (e && /Could not load/.test(e.message || '')) message = 'The PDF engine could not be downloaded. Check your connection and try again.';
    else message = 'Import failed: ' + ((e && e.message) || e);
    if (batch) return { status: 'error', message, quota, cancelled: !!(e && e.cancelled) };
    showMsg(e && e.cancelled ? '' : 'err', message);
  } finally {
    if (pdf) { try { pdf.destroy(); } catch (e) {} }
  }
}
function userError(msg) { const e = new Error(msg); e.user = true; return e; }
function cancelError() { const e = new Error('cancelled'); e.cancelled = true; return e; }
$('cancelBtn').onclick = () => { if (job) { job.cancelled = true; $('importMeta').textContent = 'Cancelling…'; } };
$('addBtn').onclick = () => $('fileIn').click();
$('fileIn').onchange = e => { const f = e.target.files[0]; e.target.value = ''; if (f) importPdf(f); };
const libPanel = $('libPanel');
libPanel.addEventListener('dragover', e => { e.preventDefault(); $('drop').classList.add('over'); });
libPanel.addEventListener('dragleave', e => { if (!libPanel.contains(e.relatedTarget)) $('drop').classList.remove('over'); });
libPanel.addEventListener('drop', e => { e.preventDefault(); $('drop').classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) importPdf(f); });

/* ===== Document view: original PDF pages, tap a word, highlight the reading position ===== */
const docv = { bookId: null, pdfPromise: null, pdf: null, pages: [], tops: [], cssW: 0, pick: null, posPage: -1, raf: 0, sync: false };
const docScroll = $('docScroll'), pagesEl = $('pages');

function docClose() {
  docv.pages.forEach(st => unrenderPage(st));
  if (docv.pdf) { try { docv.pdf.destroy(); } catch (e) {} }
  Object.assign(docv, { bookId: null, pdfPromise: null, pdf: null, pages: [], tops: [], pick: null, posPage: -1 });
  pagesEl.textContent = '';
  $('docPanel').hidden = true;
  setPick(null);
}

function docOpen(b) {
  if (!b || !b.id || !b.pageSizes) { docClose(); return; }
  if (docv.bookId === b.id) { docRefreshPos(); return; }
  docClose();
  docv.bookId = b.id;
  $('docPanel').hidden = false;
  $('pageTotal').textContent = fmtN(b.pages.length);
  $('pageIn').max = b.pages.length;
  const frag = document.createDocumentFragment();
  docv.pages = b.pages.map((_, p) => {
    const el = document.createElement('div'); el.className = 'pg'; el.dataset.p = p;
    const ph = document.createElement('div'); ph.className = 'ph'; ph.textContent = `Page ${p + 1}`;
    const hl = document.createElement('div'); hl.className = 'hl';
    el.append(ph, hl); frag.appendChild(el);
    return { p, el, hl, state: 'none', seq: 0, promise: null, canvas: null, tl: null, textDivs: null };
  });
  pagesEl.appendChild(frag);
  docLayout();
  docGoToToken(player.idx, false);
}

function docLayout() {
  const b = book; if (!b || !docv.pages.length) return;
  docv.cssW = Math.max(200, Math.min(900, docScroll.clientWidth - 24));
  docv.pages.forEach((st, p) => {
    const [w, h] = b.pageSizes[p] || [0, 0];
    st.el.style.width = docv.cssW + 'px';
    st.el.style.height = Math.round(docv.cssW * (w && h ? h / w : 1.414)) + 'px';
    unrenderPage(st);
  });
  docv.tops = docv.pages.map(st => st.el.offsetTop);
  docUpdateVisible();
}

function ensureDocPdf() {
  if (docv.pdf) return Promise.resolve(docv.pdf);
  if (!docv.pdfPromise) {
    const id = docv.bookId;
    docv.pdfPromise = (async () => {
      const [rec] = await Promise.all([idbGet('files', id), ensurePdfjs()]);
      if (!rec || !rec.blob) throw new Error('The PDF file for this book is missing. Delete the book and add it again.');
      const data = new Uint8Array(await rec.blob.arrayBuffer());
      const pdf = await pdfjsLib.getDocument({ data, wasmUrl: PDFJS_WASM, useSystemFonts: true }).promise;
      if (docv.bookId !== id) { pdf.destroy(); throw new Error('stale'); }
      docv.pdf = pdf;
      return pdf;
    })().catch(e => { docv.pdfPromise = null; if (e.message !== 'stale') showDocError(e); throw e; });
  }
  return docv.pdfPromise;
}
function showDocError(e) { $('pickLabel').textContent = 'Could not show the PDF pages: ' + (e.message || e); }

function renderPage(st) {
  if (st.state !== 'none') return st.promise;
  st.state = 'rendering';
  const seq = ++st.seq;
  st.promise = (async () => {
    const pdf = await ensureDocPdf();
    const page = await pdf.getPage(st.p + 1);
    if (seq !== st.seq) return;
    const s = docv.cssW / page.getViewport({ scale: 1 }).width;
    const vp = page.getViewport({ scale: s });
    let os = window.devicePixelRatio || 1;
    const MAX_PX = 4e6;
    if (vp.width * vp.height * os * os > MAX_PX) os = Math.sqrt(MAX_PX / (vp.width * vp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * os); canvas.height = Math.floor(vp.height * os);
    const task = page.render({ canvasContext: canvas.getContext('2d'), viewport: vp, transform: os !== 1 ? [os, 0, 0, os, 0, 0] : null });
    await task.promise;
    if (seq !== st.seq) { canvas.width = canvas.height = 0; return; }
    const tc = await page.getTextContent();
    if (seq !== st.seq) { canvas.width = canvas.height = 0; return; }
    // Invisible text layer for tap-to-word. pdf.js 6 sizes it with CSS variables (--total-scale-factor) and
    // compensates a browser's minimum font size itself (--min-font-size), so no extra scaling is needed.
    const tvp = page.getViewport({ scale: s });
    const tl = document.createElement('div'); tl.className = 'textLayer';
    tl.style.setProperty('--total-scale-factor', s);
    st.el.insertBefore(canvas, st.hl);
    st.el.appendChild(tl);
    const layer = new pdfjsLib.TextLayer({ textContentSource: tc, container: tl, viewport: tvp });
    await layer.render();
    const textDivs = layer.textDivs;
    if (seq !== st.seq) { tl.remove(); canvas.width = canvas.height = 0; canvas.remove(); return; }
    textDivs.forEach((d, k) => { d.dataset.i = k; });
    Object.assign(st, { canvas, tl, textDivs, state: 'done' });
    st.el.classList.add('ready');
    page.cleanup();
    drawHighlights(st);
  })().catch(e => { if (st.seq === seq) st.state = 'none'; if (e && e.message !== 'stale') console.warn('Page render failed', st.p + 1, e); });
  return st.promise;
}
function unrenderPage(st) {
  st.seq++;
  if (st.canvas) { st.canvas.width = st.canvas.height = 0; st.canvas.remove(); }
  if (st.tl) st.tl.remove();
  st.hl.textContent = '';
  Object.assign(st, { state: 'none', promise: null, canvas: null, tl: null, textDivs: null });
  st.el.classList.remove('ready');
}

function pageAtScroll(y) {
  const t = docv.tops; let lo = 0, hi = t.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (t[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
function docUpdateVisible() {
  if (!docv.pages.length || $('docPanel').hidden) return;
  const top = docScroll.scrollTop, h = docScroll.clientHeight;
  const first = pageAtScroll(top), last = pageAtScroll(top + h);
  for (const st of docv.pages) {
    if (st.p >= first - 1 && st.p <= last + 1) renderPage(st);
    else if (st.state !== 'none' && (st.p < first - 3 || st.p > last + 3)) unrenderPage(st);
  }
  const mid = pageAtScroll(top + h / 3);
  if (document.activeElement !== $('pageIn')) $('pageIn').value = mid + 1;
}
docScroll.addEventListener('scroll', () => { if (!docv.raf) docv.raf = requestAnimationFrame(() => { docv.raf = 0; docUpdateVisible(); }); }, { passive: true });
new ResizeObserver(() => { const w = Math.max(200, Math.min(900, docScroll.clientWidth - 24)); if (docv.pages.length && Math.abs(w - docv.cssW) > 1) { const g = currentAnchorToken(); docLayout(); docGoToToken(g, false, true); } }).observe(docScroll);
function currentAnchorToken() { const p = pageAtScroll(docScroll.scrollTop + docScroll.clientHeight / 3); return book.first[p]; }

/* --- token <-> text layer mapping --- */
function itemAt(pg, off) { const a = pg.itemStarts; let lo = 0, hi = a.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (a[mid] <= off) lo = mid; else hi = mid - 1; } return lo; }
function tokenAtOffset(pg, off) {
  const s = pg.tokStart, n = s.length; if (!n) return -1;
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= off) lo = mid; else hi = mid - 1; }
  if (off < s[lo]) return lo;                         // before the first word
  if (off < pg.tokEnd[lo]) return lo;                 // inside a word
  return lo + 1 < n ? lo + 1 : lo;                    // whitespace: the next word
}
function tokenRects(st, local) {
  const pg = book.pages[st.p];
  if (!st.textDivs || local < 0 || local >= pg.tokStart.length || !pg.itemStarts.length) return [];
  const s = pg.tokStart[local], e = pg.tokEnd[local];
  const k1 = itemAt(pg, s), k2 = itemAt(pg, e - 1);
  const n1 = st.textDivs[k1] && st.textDivs[k1].firstChild, n2 = st.textDivs[k2] && st.textDivs[k2].firstChild;
  if (!n1 || !n2) return [];
  const r = document.createRange();
  r.setStart(n1, Math.max(0, Math.min(s - pg.itemStarts[k1], n1.length)));
  r.setEnd(n2, Math.max(0, Math.min(e - pg.itemStarts[k2], n2.length)));
  return [...r.getClientRects()].filter(x => x.width > 0.5 && x.height > 0.5);
}
function hitTest(st, x, y, target) {
  if (!st.textDivs) return null;
  const pg = book.pages[st.p];
  let node = null, off = 0;
  try {
    if (document.caretPositionFromPoint) { const c = document.caretPositionFromPoint(x, y); if (c) { node = c.offsetNode; off = c.offset; } }
    else if (document.caretRangeFromPoint) { const c = document.caretRangeFromPoint(x, y); if (c) { node = c.startContainer; off = c.startOffset; } }
  } catch (e) {}
  let span = node ? (node.nodeType === 3 ? node.parentElement : node) : null;
  if (!span || span.dataset.i == null || !st.tl.contains(span)) {
    span = (target && target.closest && target.closest('span[data-i]')) || document.elementsFromPoint(x, y).find(el => el.dataset && el.dataset.i != null && st.tl.contains(el));
    if (!span) return null;
    const r = span.getBoundingClientRect();
    off = Math.floor((x - r.left) / Math.max(1, r.width) * span.textContent.length);
  }
  const str = span.textContent, k = +span.dataset.i;
  off = Math.max(0, Math.min(off, str.length));
  // a caret after the last letter of a word lands on the space that follows it
  if ((off === str.length || /\s/.test(str[off])) && off > 0 && !/\s/.test(str[off - 1])) off--;
  const local = tokenAtOffset(pg, pg.itemStarts[k] + off);
  return local < 0 ? null : book.first[st.p] + local;
}

/* --- highlights --- */
function drawHighlights(st) {
  st.hl.textContent = '';
  if (!st.textDivs || !book) return;
  const base = st.el.getBoundingClientRect();
  const add = (g, cls) => {
    if (g == null || book.pageOf(g) !== st.p) return;
    for (const r of tokenRects(st, g - book.first[st.p])) {
      const i = document.createElement('i'); i.className = cls;
      i.style.cssText = `left:${r.left - base.left - 1}px;top:${r.top - base.top - 1}px;width:${r.width + 2}px;height:${r.height + 2}px`;
      st.hl.appendChild(i);
    }
  };
  add(player.playing ? null : player.idx, 'pos');
  add(docv.pick, 'pick');
}
function docRefreshPos() {
  if (!docv.pages.length || !book) return;
  const p = book.pageOf(player.idx);
  if (docv.posPage >= 0 && docv.posPage !== p && docv.pages[docv.posPage]) drawHighlights(docv.pages[docv.posPage]);
  docv.posPage = p;
  if (docv.pages[p]) drawHighlights(docv.pages[p]);
}
function setPick(g) {
  const old = docv.pick;
  docv.pick = g;
  if (book && docv.pages.length) {
    if (old != null) drawHighlights(docv.pages[book.pageOf(old)]);
    if (g != null) drawHighlights(docv.pages[book.pageOf(g)]);
  }
  const btn = $('readHereBtn'), lab = $('pickLabel');
  btn.disabled = g == null;
  if (g == null) { lab.textContent = 'Tap a word on the page to choose where reading starts.'; return; }
  lab.textContent = '';
  const b = document.createElement('b'); b.textContent = `“${book.text(g)}”`;
  lab.append(b, ` · page ${book.pageOf(g) + 1} · word ${fmtN(g + 1)}`);
}

/* --- navigation --- */
async function docGoToToken(g, smooth, quiet) {
  if (!docv.pages.length || !book || !book.length) return;
  g = Math.max(0, Math.min(g, book.length - 1));
  const st = docv.pages[book.pageOf(g)];
  docScroll.scrollTo({ top: st.el.offsetTop - 12, behavior: 'auto' });
  docUpdateVisible();
  await renderPage(st);
  const rects = tokenRects(st, g - book.first[st.p]);
  if (rects.length) {
    const sr = docScroll.getBoundingClientRect();
    const y = docScroll.scrollTop + rects[0].top - sr.top - docScroll.clientHeight / 3;
    docScroll.scrollTo({ top: Math.max(0, y), behavior: smooth ? 'smooth' : 'auto' });
  }
  if (!quiet) docRefreshPos();
}
function docGoToPage(n) {
  if (!docv.pages.length) return;
  const p = Math.max(1, Math.min(docv.pages.length, n | 0)) - 1;
  docScroll.scrollTo({ top: docv.pages[p].el.offsetTop - 12 });
  docUpdateVisible();
}

pagesEl.addEventListener('click', e => {
  const sel = window.getSelection && window.getSelection();
  if (sel && !sel.isCollapsed) return;               // the person selected text; don't treat it as a tap
  const el = e.target.closest('.pg'); if (!el) return;
  const st = docv.pages[+el.dataset.p];
  const g = hitTest(st, e.clientX, e.clientY, e.target);
  if (g != null) setPick(book.visible(g));
});
$('readHereBtn').onclick = () => {
  if (docv.pick == null) return;
  const g = docv.pick;
  pause();
  setPick(null);
  player.idx = g; finished = false;
  render(book.text(g)); updateUI(); saveProgress();
  startAfterScroll(g);                               // exactly this word, no sentence rewind
};

// Scroll the reader into view, hold the chosen word on screen until the page stops moving, then play.
let pendingStart = 0, starting = false;
function startAfterScroll(g) {
  const token = ++pendingStart;
  starting = true;
  $('stateLabel').textContent = 'Starting';
  reader.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  let last = NaN, still = 0;
  const t0 = performance.now();
  const check = () => {
    if (token !== pendingStart) return;
    const top = reader.getBoundingClientRect().top;
    still = Math.abs(top - last) < 0.5 ? still + 1 : 0;
    last = top;
    if (still >= 8 || performance.now() - t0 > 2500) setTimeout(() => { if (token === pendingStart) { pendingStart++; starting = false; start(g); } }, 250);
    else requestAnimationFrame(check);
  };
  requestAnimationFrame(check);
}
function cancelPendingStart() { if (!starting) return false; starting = false; pendingStart++; updateUI(); return true; }
$('docBtn').onclick = () => {
  pause(); hideImage();
  $('docPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  docGoToToken(player.idx, false);
};
$('toPosBtn').onclick = () => docGoToToken(player.idx, true);
$('pageIn').addEventListener('change', e => docGoToPage(+e.target.value));
$('pageIn').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); docGoToPage(+e.target.value); e.target.blur(); } });

/* ===== Image pauses ===== */
let imageMode = null, suppressBefore = -1, imgSeq = 0;
const justShown = new Set();
function imagesOn() { return settings(true).showImages !== false; }
function imageBetween(a, b) {
  if (!book || !book.id || !imagesOn()) return null;
  for (const im of book.images) {
    if (im.g >= b) break;
    if (im.g >= a && im.g >= suppressBefore && !justShown.has(im.n)) return im;
  }
  return null;
}
async function showImage(img, next) {
  imageMode = { img, next };
  releaseWake(); saveProgress();
  $('imgView').hidden = false;
  $('imgCap').textContent = `Image · page ${img.p + 1} · tap the picture to continue`;
  updateUI();
  $('imgContBtn').focus({ preventScroll: true });
  await drawImage();
}
let drawnFor = null;
async function drawImage() {
  if (!imageMode) return;
  const { img } = imageMode, cv = $('imgCanvas'), box = $('imgBox');
  const seq = ++imgSeq;
  cv.dataset.ready = '';
  try {
    const pdf = await ensureDocPdf();
    const page = await pdf.getPage(img.p + 1);
    if (seq !== imgSeq) return;
    const r1 = viewportRect(page.getViewport({ scale: 1 }), img.bbox);
    const bw = Math.abs(r1[2] - r1[0]), bh = Math.abs(r1[3] - r1[1]);
    const W0 = Math.max(50, box.clientWidth), H0 = Math.max(50, box.clientHeight);
    const fit = Math.min(W0 / bw, H0 / bh);
    let s = fit * (window.devicePixelRatio || 1);
    s = Math.max(Math.min(s, 4096 / bw, 4096 / bh, Math.sqrt(1.2e7 / (bw * bh))), 0.5);
    const vp = page.getViewport({ scale: s }), r = viewportRect(vp, img.bbox);
    const left = Math.min(r[0], r[2]), top = Math.min(r[1], r[3]);
    const vp2 = page.getViewport({ scale: s, offsetX: -left, offsetY: -top });
    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.round(bw * s)); off.height = Math.max(1, Math.round(bh * s));
    await page.render({ canvasContext: off.getContext('2d'), viewport: vp2 }).promise;
    if (seq !== imgSeq) { off.width = off.height = 0; return; }
    cv.width = off.width; cv.height = off.height;
    cv.getContext('2d').drawImage(off, 0, 0);
    off.width = off.height = 0;
    drawnFor = [W0, H0];
    cv.dataset.ready = '1';
  } catch (e) {
    console.warn('Image render failed', img.p + 1, e);
    if (seq === imgSeq) $('imgCap').textContent = `Could not show the image on page ${img.p + 1} · continue to keep reading`;
  }
}
let redrawTimer = 0;
new ResizeObserver(() => {
  if (!imageMode || !drawnFor) return;
  const box = $('imgBox'), w = box.clientWidth, h = box.clientHeight;
  if (Math.abs(w - drawnFor[0]) / drawnFor[0] < 0.15 && Math.abs(h - drawnFor[1]) / drawnFor[1] < 0.15) return;
  clearTimeout(redrawTimer); redrawTimer = setTimeout(drawImage, 150);
}).observe($('imgBox'));
$('imgView').addEventListener('click', e => e.stopPropagation());   // it sits inside the reader: a tap here must not also pause or play
$('imgBox').addEventListener('click', () => continueImage());
$('imgContBtn').addEventListener('click', () => continueImage());
$('imgDocBtn').addEventListener('click', () => {
  if (!imageMode) return;
  const { img, next } = imageMode;
  hideImage();
  player.idx = next; render(book.text(next)); updateUI(); saveProgress();   // resuming continues after the picture
  $('docPanel').scrollIntoView({ block: 'start', behavior: 'smooth' });
  docGoToToken(img.g, false);
});
function hideImage() {
  if (!imageMode) return;
  imageMode = null; imgSeq++; drawnFor = null;
  $('imgView').hidden = true;
  const cv = $('imgCanvas'); cv.width = cv.height = 0;
  updateUI();
}
function continueImage() {
  if (!imageMode) return;
  const { img, next } = imageMode;
  justShown.add(img.n);
  hideImage();
  const more = imageBetween(img.g, next);
  if (more) { showImage(more, next); return; }
  start(next, true);
}
$('imgOn').addEventListener('change', e => { settings(false, { showImages: e.target.checked }); if (!e.target.checked && imageMode) continueImage(); });

/* ===== Moving reading positions between devices or app addresses ===== */
// Books are identified by a fingerprint of the PDF file, so positions match the same PDF imported anywhere.
async function exportPositions() {
  const [docs, progs] = await Promise.all([idbAll('documents'), idbAll('progress')]);
  const titles = new Map(docs.map(d => [d.id, d.title]));
  const s = settings(true);
  return JSON.stringify({ app: 'rsvp-reader', v: 1, positions: progs.map(p => ({ id: p.docId, title: titles.get(p.docId) || '', tokenIndex: p.tokenIndex, updatedAt: p.updatedAt })),
    settings: { wpm: s.wpm, sent: s.sent, skipRunning: s.skipRunning, showImages: s.showImages } });
}
async function importPositions(text) {
  const data = parsePositionsExport(text);           // throws a user-facing error for anything that is not an export
  let applied = 0, older = 0;
  for (const p of data.positions) {
    const cur = await idbGet('progress', p.id);
    if (cur && cur.updatedAt >= p.updatedAt) { older++; continue; }
    await idbPut('progress', { docId: p.id, tokenIndex: p.tokenIndex, updatedAt: p.updatedAt });
    applied++;
  }
  if (Object.keys(data.settings).length) settings(false, data.settings);
  return { applied, older, skipped: data.skipped, total: data.total };
}
$('copyPosBtn').onclick = async () => {
  const text = await exportPositions();
  $('posBox').hidden = false; $('posApply').hidden = true; $('posLabel').textContent = 'Reading positions, copied. Paste them into the app on your other device or address.';
  const ta = $('posText'); ta.value = text; ta.readOnly = true;
  try { await navigator.clipboard.writeText(text); $('posMsg').textContent = 'Copied.'; }
  catch (e) { ta.focus(); ta.select(); $('posMsg').textContent = 'Select the text above and copy it.'; }
};
$('pastePosBtn').onclick = () => {
  $('posBox').hidden = false; $('posApply').hidden = false; $('posLabel').textContent = 'Paste the copied reading positions here, then Apply. A newer position on this device is kept.';
  const ta = $('posText'); ta.value = ''; ta.readOnly = false; ta.focus(); $('posMsg').textContent = '';
};
$('posClose').onclick = () => { $('posBox').hidden = true; };
$('posApply').onclick = async () => {
  try {
    const r = await importPositions($('posText').value);
    $('posMsg').textContent = `Applied ${r.applied} of ${r.total}` + (r.older ? ` (${r.older} kept: newer here)` : '') + (r.skipped ? ` (${r.skipped} invalid, ignored)` : '') + '. Books you add later resume at these positions.';
    const s = validSettings();
    if (s.wpm) player.wpm = s.wpm; if (s.sent) setSentenceFactor(s.sent);
    $('sentPause').value = FACTOR.sent; $('sentOut').textContent = FACTOR.sent + '×';
    $('skipRun').checked = s.skipRunning !== false; $('imgOn').checked = s.showImages !== false;
    await refreshLibrary();
    if (book && book.id) openBook(book.id, false); else updateUI();
  } catch (e) { $('posMsg').textContent = e.message || String(e); }
};

/* ===== Library backup (DEX-01): every PDF + positions + settings in one ZIP file ===== */
// The original PDFs are kept, so a restore re-imports them through importPdf: nothing processed comes from the file.
const bytesOf = async (blob) => new Uint8Array(await blob.arrayBuffer());
async function backupLibrary() {
  const docs = (await idbAll('documents')).sort((a, b) => a.createdAt - b.createdAt);
  if (!docs.length) throw userError('The library is empty. There is nothing to back up.');
  const entries = [], books = [];
  for (const [i, d] of docs.entries()) {
    showMsg('', `Preparing backup: book ${fmtN(i + 1)} / ${fmtN(docs.length)}…`);
    const f = await idbGet('files', d.id);
    if (!f || !f.blob) continue;
    // CRC in 8 MB steps, so a large book is never held twice in memory
    let crc = 0;
    for (let o = 0; o < f.blob.size; o += 8 * MB) crc = crc32Update(crc, await bytesOf(f.blob.slice(o, o + 8 * MB)));
    books.push(d);
    entries.push({ name: `books/${books.length}.pdf`, size: f.blob.size, crc, data: f.blob });
  }
  const pos = JSON.parse(await exportPositions());
  const manifest = new TextEncoder().encode(libraryManifest({ books, positions: pos.positions, settings: pos.settings }));
  entries.unshift({ name: BACKUP.manifest, size: manifest.length, crc: crc32Update(0, manifest), data: manifest });
  const blob = new Blob(zipParts(entries), { type: 'application/zip' });
  const name = `rsvp-library-${new Date().toISOString().slice(0, 10)}.zip`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  return { books: books.length, bytes: blob.size, name };
}
$('backupBtn').onclick = async () => {
  if (job) { showMsg('err', 'Wait for the current import to finish.'); return; }
  $('backupBtn').disabled = true;
  try {
    const r = await backupLibrary();
    showMsg('ok', `Saved “${r.name}”: ${fmtN(r.books)} book${r.books === 1 ? '' : 's'}, ${(r.bytes / MB).toFixed(1)} MB, with reading positions and settings. Keep it somewhere safe; it contains your books.`);
  } catch (e) { showMsg('err', e.user ? e.message : 'Backup failed: ' + ((e && e.message) || e)); }
  finally { $('backupBtn').disabled = false; }
};

async function readBackup(file) {
  if (file.size < 22) throw userError('This file is not a library backup from this app, or it is damaged.');
  const end = readEnd(await bytesOf(file.slice(file.size - 22)), file.size);
  const entries = readCentral(await bytesOf(file.slice(end.cdOffset, end.cdOffset + end.cdSize)), end);
  for (const e of entries) checkLocal(await bytesOf(file.slice(e.offset, e.dataOffset)), e);
  const byName = new Map(entries.map(e => [e.name, e]));
  const m = byName.get(BACKUP.manifest);
  const mBytes = await bytesOf(file.slice(m.dataOffset, m.dataOffset + m.size));
  if (crc32Update(0, mBytes) !== m.crc) throw userError('This file is not a library backup from this app, or it is damaged.');
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(mBytes); } catch { throw userError('This file is not a library backup from this app, or it is damaged.'); }
  const manifest = parseLibraryManifest(text, entries.map(e => e.name));
  return { manifest, byName };
}
async function restoreLibrary(file) {
  const { manifest, byName } = await readBackup(file);
  const n = { added: 0, exists: 0, failed: [], changed: 0 };
  let stopped = null;
  for (const [i, b] of manifest.books.entries()) {
    const e = byName.get(b.file);
    const name = (b.fileName && /\.pdf$/i.test(b.fileName) ? b.fileName : (b.title || `book-${i + 1}`) + '.pdf');
    // a lazy slice of the backup: the PDF is read once, by importPdf
    const pdf = new File([file.slice(e.dataOffset, e.dataOffset + e.size)], name, { type: 'application/pdf' });
    showMsg('', `Restoring book ${fmtN(i + 1)} / ${fmtN(manifest.books.length)}: ${b.title || name}`);
    const r = await importPdf(pdf, { batch: true });
    if (r.status === 'added') { n.added++; if (r.id !== b.id) n.changed++; }
    else if (r.status === 'exists') n.exists++;
    else if (r.cancelled || r.quota) { stopped = r.message; break; }
    else n.failed.push(`${b.title || name}: ${r.message}`);
  }
  // positions and settings: same rules as pasted positions (a newer position on this device is kept)
  const pos = await importPositions(JSON.stringify({ app: 'rsvp-reader', v: 1, positions: manifest.positions, settings: manifest.settings }));
  return { ...n, total: manifest.books.length, skipped: manifest.skipped, stopped, positions: pos.applied };
}
$('restoreBtn').onclick = () => { if (job) { showMsg('err', 'Wait for the current import to finish.'); return; } $('restoreIn').click(); };
$('restoreIn').onchange = async (ev) => {
  const f = ev.target.files[0]; ev.target.value = '';
  if (!f) return;
  if (!dbOk) { showMsg('err', 'Local storage is not available in this browser window, so books cannot be restored.'); return; }
  $('restoreBtn').disabled = $('backupBtn').disabled = true;
  try {
    const r = await restoreLibrary(f);
    const parts = [`Restored ${fmtN(r.added)} of ${fmtN(r.total)} book${r.total === 1 ? '' : 's'}`];
    if (r.exists) parts.push(`${fmtN(r.exists)} already in the library`);
    if (r.positions) parts.push(`${fmtN(r.positions)} reading position${r.positions === 1 ? '' : 's'} applied`);
    let text = parts.join(', ') + '.';
    if (r.changed) text += ` ${r.changed} PDF file(s) differ from when the backup was made; their reading positions could not be matched.`;
    if (r.failed.length) text += ` Not restored: ${r.failed.join('; ')}.`;
    if (r.skipped) text += ` ${r.skipped} invalid entr${r.skipped === 1 ? 'y was' : 'ies were'} ignored.`;
    if (r.stopped) text += ` Stopped: ${r.stopped}`;
    showMsg(r.failed.length || r.stopped ? 'err' : 'ok', text);
    const s = validSettings();
    if (s.wpm) player.wpm = s.wpm; if (s.sent) setSentenceFactor(s.sent);
    $('sentPause').value = FACTOR.sent; $('sentOut').textContent = FACTOR.sent + '×';
    $('skipRun').checked = s.skipRunning !== false; $('imgOn').checked = s.showImages !== false;
    await refreshLibrary();
    if (book && book.id) openBook(book.id, false); else updateUI();
  } catch (e) { showMsg('err', e.user ? e.message : 'Restore failed: ' + ((e && e.message) || e)); }
  finally { $('restoreBtn').disabled = $('backupBtn').disabled = false; }
};

/* ===== Install (hosted build only) ===== */
let installEvent = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; $('installBtn').hidden = false; });
$('installBtn').onclick = async () => {
  if (!installEvent) return;
  installEvent.prompt();
  try { await installEvent.userChoice; } catch (e) {}
  installEvent = null; $('installBtn').hidden = true;
};
window.addEventListener('appinstalled', () => { $('installBtn').hidden = true; $('installNote').hidden = true; });
{
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !standalone) { $('installNote').hidden = false; $('installNote').textContent = 'To install on iPhone or iPad: tap Share, then “Add to Home Screen”.'; }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
}

/* ===== Acceptance checks ===== */
function addResult(kind, text, detail) {
  const d = document.createElement('div');
  d.className = 'res ' + kind;
  const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = kind === 'ok' ? 'PASS' : kind === 'bad' ? 'FAIL' : 'INFO';
  const t = document.createElement('div'); t.className = 'txt'; t.textContent = text;
  if (detail) { const s = document.createElement('small'); s.textContent = detail; t.appendChild(s); }
  d.append(chip, t); $('results').appendChild(d);
}

function unitChecks() {
  const pivots = [['a',0],['it',1],['word',1],['hello,',1],['really',2],['beautiful',2],['remarkable',3],['mother-in-law',3],['responsibilities',4],["don't",1],["I'm",2],['(word)',2],['U.S.',2],['3.14',2],['$1,250',3]];
  const bad = pivots.filter(([w, e]) => pivotIndex(w) !== e).map(([w, e]) => `${w}: got ${pivotIndex(w)}, expected ${e}`);
  addResult(bad.length ? 'bad' : 'ok', `Pivot index matches the blueprint table (${pivots.length - bad.length}/${pivots.length})`, bad.join(' · '));

  const tok = s => tokenize(s).map(t => t.text);
  const cases = [["don't",["don't"]],['mother-in-law',['mother-in-law']],['U.S.',['U.S.']],['3.14',['3.14']],['$1,250',['$1,250']],['hello,',['hello,']],['word—word',['word—','word']],['https://example.com',['https://example.com']],['impor-\ntant',['important']],['wait — what',['wait—','what']]];
  const tbad = cases.filter(([i, e]) => JSON.stringify(tok(i)) !== JSON.stringify(e)).map(([i, e]) => `${JSON.stringify(i)} → ${JSON.stringify(tok(i))}, expected ${JSON.stringify(e)}`);
  addResult(tbad.length ? 'bad' : 'ok', `Tokenizer splits the blueprint examples correctly (${cases.length - tbad.length}/${cases.length})`, tbad.join(' · '));

  const o1 = tokenize('impor-\ntant end')[0], o2 = tokenize('so — then')[0];
  const ok0 = o1.start === 0 && o1.end === 11 && o2.start === 0 && o2.end === 4;
  addResult(ok0 ? 'ok' : 'bad', 'Merged words keep source offsets that cover every part', ok0 ? '' : `impor-/tant ${o1.start}–${o1.end} (expected 0–11), "so —" ${o2.start}–${o2.end} (expected 0–4)`);

  const fl = tokenize('The U.S. army met Mr. Smith and J. Doe. Then it ended');
  const sentAt = fl.filter(t => t.flags & F.SENT).map(t => t.text);
  const ok3 = JSON.stringify(sentAt) === JSON.stringify(['Doe.']);
  addResult(ok3 ? 'ok' : 'bad', 'Abbreviations and initials do not end a sentence', ok3 ? '' : `Sentence ends found at: ${sentAt.join(', ')}`);

  const ft = tokenize('plain beautiful incomprehensibilities word, end. last').map(t => +factorOf(t.flags, t.n).toFixed(2));
  const fe = [1, 1.2, 1.4, 1.5, FACTOR.sent, FACTOR.para];
  const ok4 = JSON.stringify(ft) === JSON.stringify(fe);
  addResult(ok4 ? 'ok' : 'bad', `Duration factors: plain 1.0, 9–12 letters 1.2, 13+ letters 1.4, clause 1.5, sentence ${FACTOR.sent}, paragraph ${FACTOR.para}`, ok4 ? '' : `Got ${ft.join(', ')}`);

  const pf = tokenize('end of a page', { finalPara: false });
  const ok6 = !(pf[pf.length - 1].flags & F.PARA);
  addResult(ok6 ? 'ok' : 'bad', 'A PDF page break does not add a paragraph pause');

  const fA = Uint8Array.from(tokenize('One two three. Four five six seven. Eight nine.'), t => t.flags);
  const fB = Uint8Array.from(tokenize(Array.from({ length: 60 }, (_, i) => 'w' + i).join(' ')), t => t.flags);
  const r1 = rewindTarget(fA, 5), r2 = prevSentence(fA, 3), r3 = nextSentence(fA, 1), r4 = rewindTarget(fB, 50);
  const ok5 = r1 === 3 && r2 === 0 && r3 === 3 && r4 === 30;
  addResult(ok5 ? 'ok' : 'bad', 'Resume rewinds to the sentence start, at most 20 words; sentence steps land on sentence starts', ok5 ? '' : `rewind ${r1}/3, back ${r2}/0, forward ${r3}/3, cap ${r4}/30`);
}

function coverageCheck() {
  if (!book || !book.length) { addResult('info', 'Text coverage: nothing open in the reader. Open a book and run again.'); return; }
  let badPages = [], order = 0;
  book.pages.forEach((pg, p) => {
    let joined = '', prevEnd = 0, ok = true;
    for (let j = 0; j < pg.tokStart.length; j++) {
      if (pg.tokStart[j] < prevEnd || pg.tokEnd[j] <= pg.tokStart[j]) ok = false;
      prevEnd = pg.tokEnd[j];
      joined += pg.text.slice(pg.tokStart[j], pg.tokEnd[j]);
    }
    if (!ok) order++;
    if (!ok || joined.replace(/\s/g, '') !== pg.text.replace(/\s/g, '')) badPages.push(p + 1);
  });
  addResult(badPages.length ? 'bad' : 'ok',
    `Every character of “${book.title}” belongs to exactly one word, in order (${fmtN(book.pages.length)} page${book.pages.length > 1 ? 's' : ''}, ${fmtN(book.length)} words)`,
    badPages.length ? `Problem pages: ${badPages.slice(0, 20).join(', ')}` : 'No skipped or duplicated text.');
}

function alignmentCheck() {
  const src = tokenize(SAMPLE + '\n\nSupercalifragilisticexpialidocious pneumonoultramicroscopicsilicovolcanoconiosis https://example.com/a/rather/long/path/that-keeps-going?query=1').map(t => t.text);
  const list = Array.from({ length: 1000 }, (_, i) => src[i % src.length]);
  const sr = stage.getBoundingClientRect();
  let min = Infinity, max = -Infinity; const overflow = [];
  for (const t of list) {
    render(t);
    const pr = piv.getBoundingClientRect(), rr = row.getBoundingClientRect();
    const c = pr.left + pr.width / 2 - sr.left;
    if (c < min) min = c; if (c > max) max = c;
    if (rr.left < sr.left - 0.5 || rr.right > sr.right + 0.5) overflow.push(t);
  }
  render(book && book.length ? book.text(player.idx) : null);
  const range = max - min;
  addResult(range <= 2 ? 'ok' : 'bad', `Pivot letter stays put over 1,000 words: varies by ${range.toFixed(2)} px (limit 2 px)`, `Pivot centre at ${min.toFixed(1)} px from the stage's left edge; stage is ${sr.width.toFixed(0)} px wide`);
  const uniq = [...new Set(overflow)];
  addResult(uniq.length ? 'bad' : 'ok', 'Long words shrink and stay inside the stage', uniq.length ? `Overflowing: ${uniq.join(', ')}` : '');
}

async function mappingCheck() {
  if (!book || !book.id || !docv.pages.length) { addResult('info', 'Tap-to-word mapping: open a PDF book from the library and run again.'); return; }
  const was = player.idx;
  $('docPanel').scrollIntoView({ block: 'start' });
  const cand = docv.pages.filter(st => book.pages[st.p].tokStart.length >= 20);
  if (!cand.length) { addResult('info', 'Tap-to-word mapping: no page with enough text.'); return; }
  const chosen = [...new Set(Array.from({ length: Math.min(5, cand.length) }, (_, k) => cand[Math.floor((k + 0.5) * cand.length / Math.min(5, cand.length))]))];
  let ok = 0, total = 0, noBox = 0; const fails = [];
  for (const st of chosen) {
    const n = book.pages[st.p].tokStart.length;
    const locals = new Set(); while (locals.size < Math.min(4, n)) locals.add(Math.floor(Math.random() * n));
    for (const local of locals) {
      const g = book.first[st.p] + local;
      await docGoToToken(g, false, true);
      total++;
      const rects = tokenRects(st, local);
      if (!rects.length) { noBox++; fails.push(`p. ${st.p + 1} “${book.text(g)}”: no box on the page`); continue; }
      const r = rects[0], x = r.left + r.width / 2, y = r.top + r.height / 2;
      const got = hitTest(st, x, y, document.elementFromPoint(x, y));
      if (got === g) ok++; else fails.push(`p. ${st.p + 1} tapped “${book.text(g)}”, got “${got == null ? 'nothing' : book.text(got)}”`);
    }
  }
  await docGoToToken(was, false);
  addResult(ok >= Math.ceil(total * 0.95) ? 'ok' : 'bad', `Tapping a word on the page selects that word: ${ok}/${total} (limit 95%) across ${chosen.length} pages`, fails.slice(0, 6).join(' · ') || 'Every tapped word matched.');
}

async function imageCheck() {
  if (!book || !book.id) return;
  const imgs = book.images;
  if (!imgs.length) { addResult('info', 'Images: none found in this book, so reading never pauses for one.'); return; }
  if (!imagesOn()) { addResult('info', 'Images: “Pause and show images” is off, so this check was skipped.'); return; }
  const img = imgs[0], was = player.idx, wpm = player.wpm;
  reader.scrollIntoView({ block: 'nearest' });
  player.wpm = 1000;
  lastStop = null;
  const t0 = performance.now();
  player.idx = img.g; start(Math.max(0, img.g - 3));
  const startedPlaying = player.playing;
  while (!(imageMode && $('imgCanvas').dataset.ready) && performance.now() - t0 < 6000) await new Promise(r => setTimeout(r, 50));
  const shown = !!imageMode && imageMode.img.n === img.n;
  // If reading never reached the image, say why (device tests showed a one-off failure that could not be reproduced).
  const why = shown ? '' : !startedPlaying ? ' Playback did not start.'
    : lastStop ? ` Playback stopped ${Math.round(lastStop.t - t0)} ms after the start: ${lastStop.reason}.`
    : player.playing ? ` Still reading at word ${player.idx + 1}; the image comes after word ${img.g + 1}.` : ' Playback stopped for an unknown reason.';
  let painted = false;
  if (shown && $('imgCanvas').dataset.ready) {
    const cv = $('imgCanvas'), d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    // A blank canvas is transparent (0,0,0,0) or one flat colour: require at least two different opaque colours.
    const seen = new Set();
    for (let i = 0; i < d.length && seen.size < 2; i += 4 * 97) if (d[i + 3] > 0) seen.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    painted = seen.size >= 2;
  }
  const after = shown ? book.text(img.g) : '';
  let resumed = false;
  if (shown) { continueImage(); await new Promise(r => setTimeout(r, 120)); resumed = player.playing && player.idx >= img.g + 1 && player.idx <= img.g + 3; }
  pause(); hideImage();
  player.wpm = wpm; player.idx = was; render(book.text(was)); updateUI();
  addResult(shown && painted && resumed ? 'ok' : 'bad',
    `Reading pauses at the first image (page ${img.p + 1}), shows it, and continues on tap`,
    shown ? `Shown after “${after}”. Picture drawn: ${painted ? 'yes' : 'no'}. Continued with the next word: ${resumed ? 'yes' : 'no'}. ${imgs.length} image${imgs.length > 1 ? 's' : ''} in this book.` : 'Reading did not stop at the image.' + why);
}

let testPlayer = null;
function timingCheck() {
  return new Promise(resolve => {
    const words = 'the quiet river moved slowly past old stone walls and green fields where small birds sang'.split(' ');
    const list = Array.from({ length: 120 }, (_, i) => words[i % words.length]);
    const times = [];
    let aborted = false;
    const finish = () => { const end = performance.now(); testPlayer = null; resolve({ aborted, times, end, n: list.length }); };
    testPlayer = new Player({ count: () => list.length, factor: () => 1, wpm: 600, onShow: i => { times.push(performance.now()); render(list[i]); }, onFinish: finish });
    testPlayer.abort = () => { aborted = true; testPlayer.pause(); finish(); };
    testPlayer.play(0);
  });
}

$('checkBtn').onclick = async () => {
  $('results').textContent = ''; pause();
  unitChecks(); coverageCheck(); alignmentCheck();
  $('checkBtn').disabled = true;
  try { await mappingCheck(); } catch (e) { addResult('bad', 'Tap-to-word check failed to run: ' + (e.message || e)); }
  try { await imageCheck(); } catch (e) { addResult('bad', 'Image check failed to run: ' + (e.message || e)); }
  $('checkBtn').disabled = false;
};
$('timeBtn').onclick = async () => {
  pause();
  testing = true; updateUI();
  reader.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  const r = await timingCheck();
  testing = false;
  render(book && book.length ? book.text(player.idx) : null); updateUI();
  if (r.aborted) { addResult('bad', 'Timing check stopped because the tab was hidden. Run it again with this tab in front.'); return; }
  const base = 100;
  const measured = r.end - r.times[1];
  const expected = base * (r.n - 1);
  const errPct = (measured - expected) / expected * 100;
  let worst = 0;
  for (let i = 2; i < r.times.length; i++) worst = Math.max(worst, Math.abs(r.times[i] - r.times[i - 1] - base));
  addResult(Math.abs(errPct) <= 1 ? 'ok' : 'bad',
    `119 words at 600 wpm took ${fmtN(Math.round(measured))} ms; expected ${fmtN(expected)} ms (error ${errPct >= 0 ? '+' : ''}${errPct.toFixed(2)}%, limit ±1%)`,
    'Same scheduler as the reader. Extrapolates to the blueprint criterion of 600 words at 300 wpm in 120 s ± 1%.');
  addResult('info', `Largest single-word timing jitter: ${worst.toFixed(1)} ms`, 'Jitter on one word is not carried into the next; the deadline scheduler absorbs it.');
};

/* ===== boot ===== */
(async function boot() {
  const s = validSettings();
  $('src').value = typeof s.text === 'string' ? s.text : SAMPLE;
  if (s.wpm) player.wpm = s.wpm;
  if (s.sent) setSentenceFactor(s.sent);
  $('sentPause').value = FACTOR.sent; $('sentOut').textContent = FACTOR.sent + '×';
  $('skipRun').checked = s.skipRunning !== false;
  $('imgOn').checked = s.showImages !== false;
  try { await Promise.race([document.fonts.load('400 48px Literata'), new Promise(r => setTimeout(r, 2500))]); await document.fonts.ready; } catch (e) {}
  measureStage();
  new ResizeObserver(() => { const w = stage.clientWidth; if (w && Math.abs(w - W) > 0.5) { measureStage(); render(book && book.length ? book.text(player.idx) : null); } }).observe(stage);
  try { await db(); const n = await cleanOrphans(); if (n) showMsg('', `Removed ${n} unfinished import${n > 1 ? 's' : ''}.`); }
  catch (e) { dbOk = false; }
  await refreshLibrary();
  const cur = s.current;
  if (cur && cur.kind === 'doc' && dbOk && libRows.has(cur.id)) await openBook(cur.id, false);
  else loadPastedText($('src').value, s.textIdx != null ? s.textIdx : (s.idx || 0));
})();
