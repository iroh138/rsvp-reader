// SPDX-License-Identifier: AGPL-3.0-only
// Core text processing for the RSVP reader: tokenizer, pivot, timing factors, PDF text cleanup and image anchoring.
// Pure functions, no DOM access. Moved verbatim from index.html (lines 306-760); only `export` was added.
/* ===== CORE (pure functions: tokenizer, pivot, timing factors) ===== */
export const F = { SKIP: 1, CLAUSE: 2, SENT: 4, PARA: 8 };
export const ALNUM = /^[\p{L}\p{N}]/u;
export const HAS_ALNUM = /[\p{L}\p{N}]/u;
export const SEG = (typeof Intl !== 'undefined' && Intl.Segmenter) ? new Intl.Segmenter('en', { granularity: 'grapheme' }) : null;
export const graphemes = t => SEG ? Array.from(SEG.segment(t), s => s.segment) : Array.from(t);
export const isAlnum = c => ALNUM.test(c);

export const ABBR = new Set(['mr.','mrs.','ms.','dr.','st.','jr.','sr.','vs.','etc.','e.g.','i.e.','u.s.','u.k.','u.n.','prof.','inc.','ltd.','co.','no.','fig.','vol.','pp.','cf.','al.','approx.','dept.','mt.','ft.','a.m.','p.m.','gen.','col.','capt.','rev.','sgt.','lt.']);

// Pivot index into the grapheme array, and core length (span between first and last letter/digit).
export function pivotOf(ch) {
  let lead = 0, tail = ch.length;
  while (lead < tail && !isAlnum(ch[lead])) lead++;
  while (tail > lead && !isAlnum(ch[tail - 1])) tail--;
  const n = tail - lead;
  if (n <= 0) return { p: Math.max(0, Math.floor((ch.length - 1) / 2)), n: 0 };
  let p = n === 1 ? 0 : n <= 5 ? 1 : n <= 9 ? 2 : n <= 13 ? 3 : 4;
  if (!isAlnum(ch[lead + p])) {
    let r = p; while (r < n && !isAlnum(ch[lead + r])) r++;
    let l = p; while (l >= 0 && !isAlnum(ch[lead + l])) l--;
    p = r < n ? r : l;
  }
  return { p: lead + p, n };
}
export function pivotIndex(token) { return pivotOf(graphemes(token)).p; }

export function flagsOf(text) {
  const core = text.replace(/["'”’»)\]}]+$/u, '');
  const last = core.slice(-1);
  if (/[.!?…]/u.test(last)) {
    const bare = core.replace(/^["'“‘«(\[{]+/u, '');
    if (!/^\p{Lu}\.$/u.test(bare) && !ABBR.has(bare.toLowerCase())) return F.SENT;
    return 0;
  }
  if (/[,;:]/.test(last) || /(—|–|--)$/.test(text)) return F.CLAUSE;
  return 0;
}

// Sentence pause is user-adjustable; paragraph pause is always 0.5 above it.
export const FACTOR = { para: 3.0, sent: 2.5, clause: 1.5, len9: 1.2, len13: 1.4 };
export function setSentenceFactor(v) { FACTOR.sent = v; FACTOR.para = v + 0.5; }
export function factorOf(flags, n) {
  const punct = flags & F.PARA ? FACTOR.para : flags & F.SENT ? FACTOR.sent : flags & F.CLAUSE ? FACTOR.clause : 1;
  const len = n >= 13 ? FACTOR.len13 : n >= 9 ? FACTOR.len9 : 1;
  return punct * len;
}

// Cut positions inside one whitespace-free run: after em dash / "--" between letters or digits,
// after en dash between letters, and after each hyphen of a compound longer than 20 characters.
export function cutRun(t) {
  const cuts = [];
  let m;
  const re1 = /[\p{L}\p{N}](?:—|--)(?=[\p{L}\p{N}])/gu;
  while ((m = re1.exec(t))) cuts.push(m.index + m[0].length);
  const re2 = /\p{L}–(?=\p{L})/gu;
  while ((m = re2.exec(t))) cuts.push(m.index + m[0].length);
  // "odjednom...polete", "wait…what": an ellipsis between letters ends the word (not inside a web address)
  if (!/:\/\/|^www\./i.test(t)) {
    const re4 = /\p{L}(?:\.{3,}|…)(?=\p{L})/gu;
    while ((m = re4.exec(t))) cuts.push(m.index + m[0].length);
  }
  cuts.sort((a, b) => a - b);
  const parts = [];
  let from = 0;
  for (const c of [...cuts, t.length]) { if (c > from) parts.push([from, c]); from = c; }
  const out = [];
  for (const [a, b] of parts) {
    const s = t.slice(a, b);
    if (s.length > 20 && s.includes('-') && !/:\/\/|^www\./i.test(s)) {
      let f = a;
      const re3 = /-(?=[^-])/g;
      while ((m = re3.exec(s))) { out.push([f, a + m.index + 1]); f = a + m.index + 1; }
      out.push([f, b]);
    } else out.push([a, b]);
  }
  return out;
}

// Tokens carry offsets into `text`; `text` (display) can differ from the raw slice
// (dehyphenation, attached symbols, soft hyphens).
export function tokenize(text, opts) {
  text = String(text);
  const finalPara = !opts || opts.finalPara !== false;
  const runs = [];
  const re = /\S+/g;
  let m, para = 0, lastEnd = 0;
  while ((m = re.exec(text))) {
    if (runs.length && /\n\s*\n/.test(text.slice(lastEnd, m.index))) para++;
    runs.push({ s: m.index, e: m.index + m[0].length, raw: m[0], para });
    lastEnd = re.lastIndex;
  }
  // 1. line-end dehyphenation, then cuts
  const words = [];
  for (let i = 0; i < runs.length; i++) {
    const u = runs[i];
    let disp = u.raw, e = u.e, merged = false;
    while (i + 1 < runs.length && runs[i + 1].para === u.para && /\p{L}-$/u.test(disp)
           && text.slice(e, runs[i + 1].s).includes('\n') && /^\p{Ll}/u.test(runs[i + 1].raw)) {
      disp = disp.slice(0, -1) + runs[i + 1].raw; e = runs[i + 1].e; i++; merged = true;
    }
    if (merged) { words.push({ s: u.s, e, disp, para: u.para }); continue; }
    for (const [a, b] of cutRun(u.raw)) words.push({ s: u.s + a, e: u.s + b, disp: u.raw.slice(a, b), para: u.para });
  }
  // 2. symbol-only pieces attach to the previous word in the paragraph, else to the next one
  const out = [];
  let prefix = null;
  const flushPrefix = () => { if (prefix) { out.push({ ...prefix }); prefix = null; } };
  for (const w of words) {
    if (prefix && prefix.para !== w.para) flushPrefix();
    if (!HAS_ALNUM.test(w.disp)) {
      const last = out[out.length - 1];
      if (last && last.para === w.para && !prefix) { last.disp += w.disp; last.e = w.e; }
      else if (prefix) { prefix.disp += w.disp; prefix.e = w.e; }
      else prefix = { ...w };
      continue;
    }
    if (prefix) { out.push({ s: prefix.s, e: w.e, disp: prefix.disp + w.disp, para: w.para }); prefix = null; continue; }
    out.push({ ...w });
  }
  flushPrefix();
  // 3. flags and core length
  return out.map((w, i) => {
    const disp = w.disp.replace(/­/g, '') || w.disp;
    const lastInPara = i === out.length - 1 ? finalPara : out[i + 1].para !== w.para;
    const flags = flagsOf(disp) | (lastInPara ? F.PARA : 0);
    return { start: w.s, end: w.e, text: disp, flags, n: pivotOf(graphemes(disp)).n };
  });
}

// Compact page record: text once, tokens as typed arrays, display text stored only where it differs.
export function buildPage(text, finalPara) {
  const toks = tokenize(text, { finalPara });
  const k = toks.length;
  const rec = { text, tokStart: new Uint32Array(k), tokEnd: new Uint32Array(k), tokFlags: new Uint8Array(k), tokLen: new Uint8Array(k), over: {} };
  toks.forEach((t, j) => {
    rec.tokStart[j] = t.start; rec.tokEnd[j] = t.end; rec.tokFlags[j] = t.flags; rec.tokLen[j] = Math.min(255, t.n);
    if (t.text !== text.slice(t.start, t.end)) rec.over[j] = t.text;
  });
  return rec;
}

export function sentenceStart(flags, i) {
  let j = i;
  while (j > 0 && !(flags[j - 1] & (F.SENT | F.PARA))) j--;
  return j;
}
export function rewindTarget(flags, i) { return Math.max(sentenceStart(flags, i), i - 20, 0); }
export function prevSentence(flags, i) {
  let s = sentenceStart(flags, i);
  if (s === i && i > 0) s = sentenceStart(flags, i - 1);
  return s;
}
export function nextSentence(flags, i) {
  let j = i;
  while (j < flags.length - 1 && !(flags[j] & (F.SENT | F.PARA))) j++;
  return Math.min(j + 1, flags.length - 1);
}

// Keyboard choice of the start word in the document view (QA-03): one word or one sentence back or forward,
// never landing on a skipped word (running header, page number, second half of a hyphenated word).
export function stepPick(book, g, dir, unit) {
  if (unit === 'sentence') return book.visible(dir < 0 ? prevSentence(book.flags, g) : nextSentence(book.flags, g));
  let i = g + dir;
  while (i >= 0 && i < book.length && book.flags[i] & F.SKIP) i += dir;
  return i < 0 || i >= book.length ? g : i;
}

// A readable sequence of tokens over one or more page records.
export class Book {
  constructor(meta, pages, opts) {
    this.meta = meta; this.id = meta.id || null; this.title = meta.title || ''; this.pages = pages; this.pageSizes = meta.pageSizes || null;
    this.skipRunning = !opts || opts.skipRunning !== false;
    this.first = new Uint32Array(pages.length + 1);
    for (let p = 0; p < pages.length; p++) this.first[p + 1] = this.first[p] + pages[p].tokStart.length;
    this.length = this.first[pages.length];
    this.flags = new Uint8Array(this.length); this.len = new Uint8Array(this.length);
    pages.forEach((pg, p) => { this.flags.set(pg.tokFlags, this.first[p]); this.len.set(pg.tokLen, this.first[p]); });
    for (let i = 0; i < this.length; i++) {
      if (!(this.flags[i] & F.SKIP)) continue;
      this.flags[i] = this.skipRunning ? F.SKIP : (this.flags[i] & ~F.SKIP);   // skipped lines never mark sentence ends
    }
    // A word hyphenated across a page break: show it whole on the first part, hide the second part.
    this.join = new Map();
    const P = F.CLAUSE | F.SENT | F.PARA;
    for (let p = 0; p + 1 < pages.length; p++) {
      let a = this.first[p + 1] - 1; while (a >= this.first[p] && this.flags[a] & F.SKIP) a--;
      let b = this.first[p + 1]; while (b < this.first[p + 2] && this.flags[b] & F.SKIP) b++;
      if (a < this.first[p] || b >= this.first[p + 2]) continue;
      const ta = this.rawText(a), tb = this.rawText(b);
      if (!/\p{L}-$/u.test(ta) || !/^\p{Ll}/u.test(tb)) continue;
      const merged = ta.slice(0, -1) + tb;
      this.join.set(a, merged);
      this.flags[a] = (this.flags[a] & ~P) | (this.flags[b] & P);
      this.flags[b] = F.SKIP;
      this.len[a] = Math.min(255, pivotOf(graphemes(merged)).n);
    }
    // Drop caps: the letter joins the first word of its paragraph; the letter itself is not read again.
    // redirect: tapping the big letter on the page chooses that word.
    this.redirect = new Map();
    pages.forEach((pg, p) => {
      for (const [c, t] of pg.caps || []) {
        const gc = this.first[p] + c, gt = this.first[p] + t;
        if (gc >= this.first[p + 1] || gt >= this.first[p + 1]) continue;
        const merged = this.rawText(gc).trim() + this.text(gt);
        this.join.set(gt, merged);
        this.len[gt] = Math.min(255, pivotOf(graphemes(merged)).n);
        this.flags[gc] = F.SKIP;
        this.redirect.set(gc, gt);
      }
    });
  }
  get images() {
    if (!this._images) this._images = (this.meta.images || []).map((im, n) => ({ n, p: im.p, bbox: im.bbox, g: this.first[im.p] + im.local })).filter(im => im.g >= 0).sort((a, b) => a.g - b.g || a.n - b.n);
    return this._images;
  }
  pageOf(i) { let lo = 0, hi = this.pages.length - 1; while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (this.first[mid] <= i) lo = mid; else hi = mid - 1; } return lo; }
  rawText(i) { const p = this.pageOf(i), l = i - this.first[p], pg = this.pages[p]; return pg.over[l] != null ? pg.over[l] : pg.text.slice(pg.tokStart[l], pg.tokEnd[l]); }
  text(i) { const j = this.join.get(i); return j != null ? j : this.rawText(i); }
  factor(i) { return this.flags[i] & F.SKIP ? 0 : factorOf(this.flags[i], this.len[i]); }
  visible(i) { if (i >= this.length) return this.length; while (i < this.length && this.flags[i] & F.SKIP) i++; if (i < this.length) return i; i = this.length - 1; while (i > 0 && this.flags[i] & F.SKIP) i--; return i; }
}
/* ===== Text cleanup (milestone 4): running headers/footers, page numbers, paragraph ends ===== */
// Line geometry comes from pdf.js text items. `yn` is the baseline height as a share of the page (1 = top).
export function extractLines(items) {
  let text = '';
  const itemStarts = [], lines = [];
  let cur = null;
  const close = () => { if (cur) lines.push(cur); cur = null; };
  for (const it of items) {
    if (typeof it.str !== 'string') continue;
    itemStarts.push(text.length);
    if (it.str.trim()) {
      const t = it.transform, x = t[4], y = t[5], h = Math.hypot(t[2], t[3]) || it.height || 0;
      if (cur && Math.abs(y - cur.y) > Math.max(2, cur.h * 0.8)) close();   // new line without an end-of-line mark
      if (!cur) cur = { s: text.length, e: text.length, x0: x, x1: x + (it.width || 0), y, h };
      else { cur.x0 = Math.min(cur.x0, x); cur.x1 = Math.max(cur.x1, x + (it.width || 0)); cur.h = Math.max(cur.h, h); }
      text += it.str;
      cur.e = text.length;
    } else text += it.str;
    if (it.hasEOL) { text += '\n'; close(); }
  }
  close();
  return { text, itemStarts, lines };
}

// Drop caps (N4, docs/pdf-corpus.md): a large first letter set beside the first lines of a paragraph. PDFs store it as a separate
// piece of text, often far from its paragraph (e.g. before the chapter title), so it would be read on its own and in
// the wrong place. Returns [[capToken, firstWordToken]] for one page; the Book reads them as one word ("A" + "n").
// A cap is a line holding only one letter (optionally after an opening quote), at least 1.8x the body text size,
// directly left of a body line whose baseline lies within the letter's height.
export function findDropCaps(rec, lines) {
  const body = lines.filter(l => rec.text.slice(l.s, l.e).trim().length > 3).map(l => l.h).sort((a, b) => a - b);
  if (!body.length) return [];
  const bh = body[body.length >> 1];
  const out = [];
  for (const cap of lines) {
    const raw = rec.text.slice(cap.s, cap.e).trim();
    if (!/^["“„«‘']?\p{L}$/u.test(raw) || cap.h < 1.8 * bh) continue;
    const beside = lines.filter(l => l !== cap && l.h < 1.5 * bh && l.x0 >= cap.x1 - bh * 0.3 && l.x0 - cap.x1 <= 3 * bh
      && l.y >= cap.y - bh * 0.5 && l.y <= cap.y + cap.h);
    if (!beside.length) continue;
    const first = beside.reduce((a, b) => (b.y > a.y ? b : a));          // the topmost line beside the letter
    const c = lowerBound(rec.tokStart, cap.s), t = lowerBound(rec.tokStart, first.s);
    if (c >= rec.tokStart.length || rec.tokStart[c] >= cap.e || t >= rec.tokStart.length || t === c) continue;
    if (!/^\p{L}/u.test(rec.text.slice(rec.tokStart[t], rec.tokEnd[t]))) continue;
    out.push([c, t]);
  }
  return out;
}

export const ROMAN = /^m{0,3}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/;
export function lineSig(t) {
  return t.toLowerCase()
    .replace(/\p{L}+/gu, w => (w.length <= 6 && ROMAN.test(w) && w !== 'i' ? '#' : w))
    .replace(/\d+/g, '#')
    .replace(/[^\p{L}#]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export const lowerBound = (a, v) => { let lo = 0, hi = a.length; while (lo < hi) { const m = (lo + hi) >> 1; if (a[m] < v) lo = m + 1; else hi = m; } return lo; };

// pdata: [{ rec, lines, ph }] per page (ph = page height). Mutates rec.tokFlags. Returns a summary.
// A line is a running header/footer when it is one of the two top or two bottom lines of its page, is short,
// and either (A) the same text repeats at the same height on nearby pages, (B) it carries a page number that
// grows with the page, or (C) it sits at the exact height of headers already confirmed by A or B.
// A and C also require a gap below/above it larger than normal line spacing, so body text is never taken.
export function romanValue(w) { const v = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 }; let n = 0; for (let i = 0; i < w.length; i++) { const a = v[w[i]], b = v[w[i + 1]] || 0; n += a < b ? -a : a; } return n; }
// Rule B: how many other words a page-number line in the flow of the text may have ("Page 12", "12 Chapter One").
export const MAX_WORDS_BESIDE_NUMBER = 3;
export function applyCleanup(pdata) {
  const groups = new Map(), numbered = new Map(), cands = [];
  pdata.forEach((pd, p) => {
    if (!pd || !pd.lines.length) return;
    const ls = pd.lines;
    for (const l of ls) { const raw = pd.rec.text.slice(l.s, l.e); l.raw = raw.trim(); l.sig = lineSig(raw); l.yn = pd.ph ? l.y / pd.ph : 0; }
    const order = ls.map((_, k) => k).filter(k => ls[k].raw).sort((a, b) => ls[b].y - ls[a].y);
    const gaps = []; for (let i = 0; i + 1 < order.length; i++) { const g = ls[order[i]].y - ls[order[i + 1]].y; if (g > 0.5 && g < 3 * (ls[order[i]].h || 10)) gaps.push(g); }
    gaps.sort((x, y) => x - y);
    const lineGap = gaps.length ? gaps[gaps.length >> 1] : 0;
    const cand = new Map();
    order.slice(0, 2).forEach(k => cand.set(k, 't'));
    order.slice(-2).forEach(k => { if (!cand.has(k)) cand.set(k, 'b'); });
    for (const [k, band] of cand) {
      const l = ls[k];
      if (!l.sig || l.sig.split(' ').length > 12) continue;
      const pos = order.indexOf(k);
      const nb = band === 't' ? ls[order[pos + 1]] : ls[order[pos - 1]];
      const apart = !nb || !lineGap || Math.abs(l.y - nb.y) > lineGap * 1.3;
      // words besides page-number-like tokens: "— 12 —" and "Page 12" have 0-1, a body sentence has many
      const words = l.sig.split(' ').filter(w => w !== '#').length;
      const c = { p, k, yn: l.yn, band, apart, words };
      cands.push(c);
      if (apart) { const key = band + '|' + l.sig; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(c); }
      // B: a number that equals the page index plus a constant offset
      const m = l.raw.toLowerCase().match(/(?:^|[^\p{L}\p{N}])(\d{1,4}|[ivxlcdm]{1,7})(?=$|[^\p{L}\p{N}])/gu);
      if (m) for (const tok of m) {
        const t = tok.replace(/^[^\p{L}\p{N}]/u, '');
        const isRoman = /^[ivxlcdm]+$/.test(t);
        if (isRoman && (!ROMAN.test(t) || t === 'i' && l.sig !== '#')) continue;
        const val = isRoman ? romanValue(t) : +t;
        const key = (isRoman ? 'r' : 'a') + (val - p);
        if (!numbered.has(key)) numbered.set(key, []);
        numbered.get(key).push(c);
      }
    }
  });
  const skip = pdata.map(() => new Set());
  const removed = [], heights = { t: [], b: [] };
  const mark = (list, label) => {
    const pages = new Set();
    for (const c of list) if (!skip[c.p].has(c.k)) { skip[c.p].add(c.k); pages.add(c.p); heights[c.band].push(c.yn); }
    if (pages.size) removed.push({ text: label, pages: pages.size });
  };
  const sample = c => pdata[c.p].lines[c.k].raw.replace(/\s+/g, ' ').slice(0, 60);
  // A
  for (const [key, arr] of groups) {
    arr.sort((a, b) => a.yn - b.yn);
    let cl = [];
    const flush = () => {
      const pages = [...new Set(cl.map(c => c.p))].sort((a, b) => a - b);
      let near = 0;
      for (let i = 1; i < pages.length; i++) if (pages[i] - pages[i - 1] <= 2) near++;
      const endsSentence = cl.length && /[.!?]["”’)]?$/.test(pdata[cl[0].p].lines[cl[0].k].raw);
      if (pages.length >= (endsSentence ? 6 : 3) && near >= 2) mark(cl, key.slice(2) === '#' ? 'page numbers' : sample(cl[0]));
      cl = [];
    };
    for (const c of arr) { if (cl.length && c.yn - cl[cl.length - 1].yn > 0.015) flush(); cl.push(c); }
    flush();
  }
  // B
  for (const [, arr] of numbered) {
    if (new Set(arr.map(c => c.p)).size < 3) continue;
    // a real page number repeats at the same height on other pages; a lone match ("CHAPTER 1" on page 1) does not.
    // N1 (docs/pdf-corpus.md): a line set off from the body by a larger gap may carry a title ("12 The Book Title"),
    // but a line in the flow of the body text must be (almost) only the number, or a body sentence that happens to
    // contain the page number ("Page 12 begins with ...") would be silently dropped.
    const ok = arr.filter(c => (c.apart || c.words <= MAX_WORDS_BESIDE_NUMBER)
      && arr.some(o => o !== c && o.p !== c.p && o.band === c.band && Math.abs(o.yn - c.yn) < 0.004));
    if (new Set(ok.map(c => c.p)).size >= 3) mark(ok, 'page numbers');
  }
  // C
  for (const c of cands) {
    if (skip[c.p].has(c.k) || !c.apart) continue;
    if (heights[c.band].some(y => Math.abs(y - c.yn) < 0.004)) mark([c], 'chapter headers');
  }
  // merge summary entries with the same label
  const merged = new Map();
  for (const r of removed) merged.set(r.text, (merged.get(r.text) || 0) + r.pages);
  removed.length = 0;
  for (const [text, pages] of merged) removed.push({ text, pages });

  let paras = 0, skippedTokens = 0;
  const markPara = (rec, l) => {
    const fl = rec.tokFlags, j = lowerBound(rec.tokStart, l.e) - 1;   // last word that ends on this line (it may start on the line above)
    if (j >= 0 && rec.tokEnd[j] > l.s && !(fl[j] & F.SKIP)) { if (!(fl[j] & F.PARA)) paras++; fl[j] |= F.PARA; }
  };
  pdata.forEach((pd, p) => {
    if (!pd) return;
    const { rec, lines } = pd, fl = rec.tokFlags;
    // headers, footers, page numbers
    for (const k of skip[p]) {
      const l = lines[k];
      for (let j = lowerBound(rec.tokStart, l.s); j < rec.tokStart.length && rec.tokStart[j] < l.e; j++) { fl[j] |= F.SKIP; skippedTokens++; }
    }
    // paragraph ends from geometry: next line indented, a larger gap, or a short last line ending a sentence
    const body = lines.filter((l, k) => !skip[p].has(k) && /[\p{L}\p{N}]/u.test(l.raw || ''));
    if (!body.length) return;
    const med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
    let fs, left, right;
    // a page with very few lines (end of a chapter) borrows margins from the page two back (same side) or the previous one
    const ref = body.length < 4 && ((pdata[p - 2] && pdata[p - 2].geo) || (pdata[p - 1] && pdata[p - 1].geo));
    if (ref) { fs = ref.fs; left = ref.left; right = ref.left + ref.width; }
    else {
      fs = med(body.map(l => l.h)) || 10;
      const xs = new Map(); body.forEach(l => { const r = Math.round(l.x0 / 2) * 2; xs.set(r, (xs.get(r) || 0) + 1); });
      left = [...xs.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
      const rights = body.map(l => l.x1).sort((a, b) => a - b);
      right = rights[Math.floor(rights.length * 0.9)];
    }
    const width = Math.max(1, right - left);
    const gaps = [];
    for (let i = 0; i + 1 < body.length; i++) { const g = body[i].y - body[i + 1].y; if (g > 0 && g < fs * 3) gaps.push(g); }
    const gap = med(gaps) || fs * 1.2;
    const isShort = l => l.x1 < right - Math.max(2 * fs, 0.08 * width);
    // justified text has many lines ending exactly at the right margin; ragged-right text has few
    const flush = body.filter(l => Math.abs(l.x1 - right) < 1.5).length;
    const ragged = ref ? !!ref.ragged : body.length < 4 || flush < body.length * 0.4;
    pd.geo = { left, fs, width, first: body[0], last: body[body.length - 1], ragged };
    for (let i = 0; i < body.length; i++) {
      const l = body[i], n = body[i + 1];
      if (/-$/.test(l.raw)) continue;
      const endsSentence = /[.!?:…]["”’)\]]?$/.test(l.raw);
      let end = false;
      if (n && n.y < l.y) {
        const ind = n.x0 - left;
        end = ind > 0.6 * fs || (l.y - n.y > gap * 1.5) || Math.abs(n.h - l.h) > 0.25 * fs;   // indent, extra space, or a heading
      }
      if (!end && !ragged && endsSentence && isShort(l)) end = true;
      if (!end) continue;
      markPara(rec, l);
    }
  });
  // across a page break: the next page starts with an indented line or a centred heading
  for (let p = 0; p + 1 < pdata.length; p++) {
    const a = pdata[p], b = pdata[p + 1];
    if (!a || !b || !a.geo || !b.geo) continue;
    const l = a.geo.last, n = b.geo.first;
    if (/-$/.test(l.raw)) continue;
    if (n.x0 - b.geo.left > 0.6 * b.geo.fs || Math.abs(n.h - l.h) > 0.25 * a.geo.fs) markPara(a.rec, l);
  }
  pdata.forEach(pd => { if (pd) delete pd.geo; });
  removed.sort((a, b) => b.pages - a.pages);
  return { removed: removed.slice(0, 8), paras, skippedTokens };
}
/* ===== Images (milestone 5): find drawn images, drop decorations, anchor each to the word before it ===== */
export const mulM = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
// Boxes of every embedded image on a page, in PDF user space [x0, y0, x1, y1].
export function findImageBoxes(fnArray, argsArray, OPS) {
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [], out = [];
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i], a = argsArray[i];
    if (fn === OPS.save || fn === OPS.beginGroup) stack.push(ctm);
    else if (fn === OPS.restore || fn === OPS.endGroup || fn === OPS.paintFormXObjectEnd) { if (stack.length) ctm = stack.pop(); }
    else if (fn === OPS.transform) ctm = mulM(ctm, a);
    else if (fn === OPS.paintFormXObjectBegin) { stack.push(ctm); if (a && Array.isArray(a[0]) && a[0].length === 6) ctm = mulM(ctm, a[0]); }
    else if (fn === OPS.paintImageXObject || fn === OPS.paintInlineImageXObject) {
      const xs = [], ys = [];
      for (const [x, y] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { xs.push(ctm[0] * x + ctm[2] * y + ctm[4]); ys.push(ctm[1] * x + ctm[3] * y + ctm[5]); }
      const px = fn === OPS.paintImageXObject ? [a[1] || 0, a[2] || 0] : [(a[0] && a[0].width) || 0, (a[0] && a[0].height) || 0];
      out.push([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys), px[0], px[1]]);
    }
  }
  return out;
}
// pdata[p]: { rec, lines (shifted to the page origin), view [x0,y0,x1,y1], boxes, letters }
// Returns [{ p, local, bbox }] where the image is shown after token `local` of page p (-1 = before the page's first word).
export function placeImages(pdata) {
  const n = pdata.length, cands = [];
  pdata.forEach((pd, p) => {
    if (!pd || !pd.boxes || !pd.boxes.length) return;
    const [vx0, vy0, vx1, vy1] = pd.view, area = (vx1 - vx0) * (vy1 - vy0);
    // clip to the page, then merge boxes that touch (one picture drawn as strips)
    let bs = pd.boxes.map(b => [Math.max(b[0], vx0), Math.max(b[1], vy0), Math.min(b[2], vx1), Math.min(b[3], vy1), b[4] || 0, b[5] || 0]).filter(b => b[2] - b[0] > 1 && b[3] - b[1] > 1);
    for (let changed = true; changed;) {
      changed = false;
      outer: for (let i = 0; i < bs.length; i++) for (let j = i + 1; j < bs.length; j++) {
        const a = bs[i], b = bs[j];
        if (a[0] <= b[2] + 2 && b[0] <= a[2] + 2 && a[1] <= b[3] + 2 && b[1] <= a[3] + 2) {
          bs[i] = [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3]), 0, 0];
          bs.splice(j, 1); changed = true; break outer;
        }
      }
    }
    for (const b of bs) {
      const w = b[2] - b[0], h = b[3] - b[1];
      if (w < 56 || h < 56 || w * h < area * 0.03) continue;                 // ornaments, icons, drop caps
      if (w * h > area * 0.85 && pd.letters >= 20) continue;                  // scanned page under its text layer
      // a picture of text that carries its own text layer (OCR) is read as words already; it is not a figure
      const bx0 = b[0] - vx0, bx1 = b[2] - vx0, by0 = b[1] - vy0, by1 = b[3] - vy0;
      let inLines = 0, inLetters = 0;
      for (const l of pd.lines || []) {
        if (l.y < by0 || l.y > by1 || l.x0 < bx0 - 2 || l.x1 > bx1 + 2) continue;
        const k = ((l.raw || '').match(/\p{L}/gu) || []).length;
        if (k) { inLines++; inLetters += k; }
      }
      if (inLines >= 3 && inLetters >= 80) continue;
      cands.push({ p, bbox: b.slice(0, 4), key: b.slice(0, 4).map(v => Math.round(v / 4)).join(',') + '|' + b[4] + 'x' + b[5] });
    }
  });
  // decoration (logo, border, background) is the same picture at the same place on page after page;
  // illustrations may share a place on the page, but they do not repeat on neighbouring pages
  const byKey = new Map();
  for (const c of cands) byKey.set(c.key, (byKey.get(c.key) || new Set()).add(c.p));
  const deco = new Set();
  for (const [key, set] of byKey) {
    const ps = [...set].sort((a, b) => a - b);
    let adjacent = 0;
    for (let i = 1; i < ps.length; i++) if (ps[i] - ps[i - 1] === 1) adjacent++;
    if (ps.length >= 3 && adjacent >= 2) deco.add(key);
  }
  const kept = cands.filter(c => !deco.has(c.key));
  const out = [];
  for (const c of kept) {
    const pd = pdata[c.p], rec = pd.rec, top = c.bbox[3] - pd.view[1];
    let local = -1, bestK = -1;
    (pd.lines || []).forEach((l, k) => {
      if (l.y <= top + 1 || k < bestK) return;                               // the last line (in reading order) above the image
      const j = lowerBound(rec.tokStart, l.e) - 1;
      if (j >= 0 && rec.tokEnd[j] > l.s && !(rec.tokFlags[j] & F.SKIP)) { bestK = k; local = j; }
    });
    out.push({ p: c.p, local, bbox: c.bbox.map(v => Math.round(v * 10) / 10) });
  }
  out.sort((a, b) => a.p - b.p || a.local - b.local || b.bbox[3] - a.bbox[3]);
  return out;
}
// PDF rectangle [x0, y0, x1, y1] -> viewport rectangle (two transformed corners, not normalised), the same as
// PageViewport.convertToViewportRectangle in pdf.js 3, which pdf.js 4+ no longer has.
export function viewportRect(vp, r) {
  const [a, b] = vp.convertToViewportPoint(r[0], r[1]), [c, d] = vp.convertToViewportPoint(r[2], r[3]);
  return [a, b, c, d];
}
// N2 (docs/pdf-corpus.md): language-independent check for broken text extraction. The old check counted common
// ENGLISH words, so every book in another language was reported as garbled. Broken extraction instead leaves
// structural traces: private-use or replacement characters, symbol soup, words mixing alphabets, missing spaces.
// A shifted alphabet ("Wkh txlfn") has none of these traces and is not detected (documented limitation).
export const GARBLED = Object.freeze({ minWords: 300, unusualChars: 0.02, symbolChars: 0.15, mixedScriptWords: 0.1, runOnWords: 0.1, runOnLetters: 40 });   // real words of 40+ letters practically never occur; run-on lines are 50-80
const UNUSUAL = /[\p{Co}\p{Cn}\p{Cc}\uFFFD]/gu;
const SYMBOL = /[\p{Sm}\p{Sk}\p{So}#*@\\^_`|~{}<>]/gu;
const SCRIPTS = [/\p{Script=Latin}/u, /\p{Script=Cyrillic}/u, /\p{Script=Greek}/u];
const SPACED_LETTERS = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}]/gu;
export function textQuality(words) {
  const n = words.length;
  let chars = 0, unusual = 0, symbols = 0, mixed = 0, runOn = 0;
  for (const w of words) {
    chars += [...w].length;
    unusual += (w.match(UNUSUAL) || []).length;
    symbols += (w.match(SYMBOL) || []).length;
    // "PDF-а" or "Facebook-у" mix alphabets across a hyphen in normal Serbian text: judge each part separately
    if (w.split(/[-‐–—]/).some(part => SCRIPTS.filter(re => re.test(part)).length > 1)) mixed++;
    if ((w.match(SPACED_LETTERS) || []).length >= GARBLED.runOnLetters) runOn++;
  }
  const r = { words: n, unusual: chars ? unusual / chars : 0, symbols: chars ? symbols / chars : 0, mixedScript: n ? mixed / n : 0, runOn: n ? runOn / n : 0 };
  const reasons = [];
  if (n >= GARBLED.minWords) {
    if (r.unusual > GARBLED.unusualChars) reasons.push('unusual characters');
    if (r.symbols > GARBLED.symbolChars) reasons.push('symbols instead of letters');
    if (r.mixedScript > GARBLED.mixedScriptWords) reasons.push('mixed alphabets inside words');
    if (r.runOn > GARBLED.runOnWords) reasons.push('missing spaces between words');
  }
  return { ...r, garbled: reasons.length > 0, reason: reasons.join(', ') };
}
/* ===== END CORE ===== */
