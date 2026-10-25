// SPDX-License-Identifier: AGPL-3.0-only
// Unit tests for src/core.js. Expected values come from the requirements (docs/phase-1/02-zahtevi.md)
// and the original milestone blueprint tables, not from running the code.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  F, FACTOR, pivotIndex, tokenize, factorOf, setSentenceFactor, buildPage, rewindTarget, prevSentence,
  nextSentence, Book, extractLines, applyCleanup,
} from '../src/core.js';

const texts = s => tokenize(s).map(t => t.text);

test('T3.4 pivot index follows the blueprint table', () => {
  const table = [['a', 0], ['it', 1], ['word', 1], ['hello,', 1], ['really', 2], ['beautiful', 2], ['remarkable', 3],
    ['mother-in-law', 3], ['responsibilities', 4], ["don't", 1], ["I'm", 2], ['(word)', 2], ['U.S.', 2], ['3.14', 2], ['$1,250', 3]];
  for (const [w, e] of table) assert.equal(pivotIndex(w), e, w);
});

test('pivot on a word without letters or digits stays inside the word', () => {
  for (const w of ['—', '...', '&']) {
    const p = pivotIndex(w);
    assert.ok(p >= 0 && p < [...w].length, w);
  }
});

test('tokenizer keeps contractions, compounds, numbers and URLs whole', () => {
  const cases = [["don't", ["don't"]], ['mother-in-law', ['mother-in-law']], ['U.S.', ['U.S.']], ['3.14', ['3.14']],
    ['$1,250', ['$1,250']], ['hello,', ['hello,']], ['https://example.com', ['https://example.com']]];
  for (const [i, e] of cases) assert.deepEqual(texts(i), e, i);
});

test('tokenizer splits after em dashes and joins line-end hyphenation', () => {
  assert.deepEqual(texts('word—word'), ['word—', 'word']);
  assert.deepEqual(texts('wait — what'), ['wait—', 'what']);
  assert.deepEqual(texts('impor-\ntant'), ['important']);
  // a hyphen at a line end before an uppercase word is not a hyphenation
  assert.deepEqual(texts('North-\nWest'), ['North-', 'West']);
});

test('merged words keep source offsets that cover every part', () => {
  const a = tokenize('impor-\ntant end')[0], b = tokenize('so — then')[0];
  assert.deepEqual([a.start, a.end], [0, 11]);
  assert.deepEqual([b.start, b.end], [0, 4]);
});

test('every non-space character belongs to exactly one token, in order', () => {
  const s = 'He said: “Stop — now!” Then (quietly) left… 3.14, $5; e.g. U.S. mother-in-law\n\nNew para — end.';
  const t = tokenize(s);
  let prev = 0, joined = '';
  for (const k of t) { assert.ok(k.start >= prev && k.end > k.start); prev = k.end; joined += s.slice(k.start, k.end); }
  assert.equal(joined.replace(/\s/g, ''), s.replace(/\s/g, ''));
});

test('T3.3 abbreviations and initials do not end a sentence', () => {
  const sent = tokenize('The U.S. army met Mr. Smith and J. Doe. Then it ended').filter(t => t.flags & F.SENT).map(t => t.text);
  assert.deepEqual(sent, ['Doe.']);
});

test('T3.3 duration factors', () => {
  setSentenceFactor(2.5);
  const got = tokenize('plain beautiful incomprehensibilities word, end. last').map(t => +factorOf(t.flags, t.n).toFixed(2));
  assert.deepEqual(got, [1, 1.2, 1.4, 1.5, 2.5, 3]);
});

test('T3.3 paragraph pause is always the sentence pause + 0.5', () => {
  for (const v of [1.5, 2.5, 4]) { setSentenceFactor(v); assert.equal(FACTOR.para, v + 0.5); }
  setSentenceFactor(2.5);
});

test('a PDF page break does not add a paragraph pause', () => {
  const t = tokenize('end of a page', { finalPara: false });
  assert.equal(t[t.length - 1].flags & F.PARA, 0);
});

test('T3.5 resume rewinds to the sentence start, at most 20 words; sentence steps', () => {
  const fA = Uint8Array.from(tokenize('One two three. Four five six seven. Eight nine.'), t => t.flags);
  const fB = Uint8Array.from(tokenize(Array.from({ length: 60 }, (_, i) => 'w' + i).join(' ')), t => t.flags);
  assert.equal(rewindTarget(fA, 5), 3);
  assert.equal(prevSentence(fA, 3), 0);
  assert.equal(nextSentence(fA, 1), 3);
  assert.equal(rewindTarget(fB, 50), 30);
  assert.equal(rewindTarget(fA, 0), 0);
});

test('T1.7 a word hyphenated across a page break is read whole once', () => {
  const pages = [buildPage('first page ends with extra-', false), buildPage('ordinary words follow.', true)];
  const b = new Book({ id: 'x', title: 't' }, pages);
  const shown = [];
  for (let i = b.visible(0); i < b.length; i = b.visible(i + 1)) shown.push(b.text(i));
  assert.deepEqual(shown, ['first', 'page', 'ends', 'with', 'extraordinary', 'words', 'follow.']);
});

// Synthetic pdf.js text items: one item per line, 10 pt type, page height 600.
function page(lines) {
  const items = lines.map(([str, x, y]) => ({ str, transform: [10, 0, 0, 10, x, y], width: str.length * 5, hasEOL: true }));
  const ex = extractLines(items);
  return { rec: buildPage(ex.text, false), lines: ex.lines, ph: 600 };
}
// Body text differs on every page and contains no numbers, like real prose.
const VOCAB = 'river stone quiet lamp morning garden letter window bridge summer voice paper silver north field candle story harbor forest winter'.split(' ');
function bodyLines(p) {
  const out = [];
  for (let k = 0; k < 20; k++) {
    const w = i => VOCAB[(p * 7 + k * 3 + i) % VOCAB.length];
    out.push([`${w(0)} ${w(1)} ${w(2)} and the ${w(3)} ${w(4)} by the ${w(5)}`, 50, 540 - k * 14]);
  }
  return out;
}

test('T1.7 running headers and page numbers are skipped, body text is kept', () => {
  const pdata = [];
  for (let p = 0; p < 6; p++) pdata.push(page([['THE FIXTURE BOOK', 50, 580], ...bodyLines(p), [String(p + 1), 150, 20]]));
  const summary = applyCleanup(pdata);
  for (const { rec } of pdata) {
    const words = Array.from(rec.tokStart, (s, j) => ({ w: rec.text.slice(s, rec.tokEnd[j]), skip: !!(rec.tokFlags[j] & F.SKIP) }));
    for (const x of words) {
      const isHeader = ['THE', 'FIXTURE', 'BOOK'].includes(x.w) || /^\d+$/.test(x.w);
      assert.equal(x.skip, isHeader, x.w);
    }
  }
  assert.ok(summary.skippedTokens >= 6 * 4);
});

test('T1.7 negative: a heading on only one page is not removed', () => {
  const pdata = [];
  for (let p = 0; p < 6; p++) pdata.push(page([...(p === 0 ? [['CHAPTER ONE', 50, 580]] : []), ...bodyLines(p)]));
  applyCleanup(pdata);
  for (const { rec } of pdata) assert.ok(rec.tokFlags.every(f => !(f & F.SKIP)));
});

test('viewportRect transforms both corners like pdf.js 3 convertToViewportRectangle', async () => {
  const { viewportRect } = await import('../src/core.js');
  // a viewport at scale 2 that flips y on a 100-unit-high page: (x, y) -> (2x, 2(100 - y))
  const vp = { convertToViewportPoint: (x, y) => [2 * x, 2 * (100 - y)] };
  assert.deepEqual(viewportRect(vp, [10, 20, 30, 60]), [20, 160, 60, 80]);
});

// N1 (docs/pdf-corpus.md): a body line that happens to contain the page number must stay readable.
function pagesWith(top, { gapBelow = 14 } = {}) {
  const pdata = [];
  for (let p = 0; p < 6; p++) {
    const lines = [...(top ? [[top(p), 50, 540 + gapBelow]] : []), ...bodyLines(p)];
    pdata.push(page(lines));
  }
  return pdata;
}
const skippedWords = (pdata) => pdata.map(({ rec }) => Array.from(rec.tokStart, (s, j) => rec.tokFlags[j] & F.SKIP ? rec.text.slice(s, rec.tokEnd[j]) : null).filter(Boolean));

test('N1 negative: a body sentence containing the page number is NOT removed', () => {
  const pdata = pagesWith(p => `Page ${p + 1} begins with a short paragraph of plain words.`);
  applyCleanup(pdata);
  assert.deepEqual(skippedWords(pdata), [[], [], [], [], [], []]);
});

test('N1: a bare page number line is still removed, with or without a gap', () => {
  for (const gapBelow of [14, 40]) {
    const pdata = pagesWith(p => String(p + 1), { gapBelow });
    applyCleanup(pdata);
    assert.deepEqual(skippedWords(pdata), [['1'], ['2'], ['3'], ['4'], ['5'], ['6']], `gap ${gapBelow}`);
  }
});

test('N1: short page-number lines ("Page 12", "— 12 —", "12 The Book Title") are still removed', () => {
  for (const make of [p => `Page ${p + 1}`, p => `— ${p + 1} —`, p => `${p + 1} The Book Title`]) {
    const pdata = pagesWith(make);
    applyCleanup(pdata);
    // symbol-only pieces attach to the number, so "— 3 —" is one word
    for (const [i, words] of skippedWords(pdata).entries()) assert.ok(words.some(w => w.replace(/[^0-9]/g, '') === String(i + 1)), `${make(i)} on page ${i + 1}`);
  }
});
