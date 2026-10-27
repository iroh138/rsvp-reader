// SPDX-License-Identifier: AGPL-3.0-only
// N4, docs/pdf-corpus.md: drop caps are read as part of the first word; an ellipsis between words splits them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, extractLines, buildPage, findDropCaps, Book, F } from '../src/core.js';

// One pdf.js text item per line: [text, x, y, size]. Order = order in the PDF file.
function page(items) {
  const its = items.map(([str, x, y, size = 11]) => ({ str, transform: [size, 0, 0, size, x, y], width: str.length * size * 0.5, hasEOL: true }));
  const ex = extractLines(its);
  return { rec: buildPage(ex.text, true), lines: ex.lines };
}
const words = (rec, caps) => { const b = new Book({ id: 'x', title: 't' }, [{ ...rec, caps }]); const w = []; for (let i = b.visible(0); i < b.length; i = b.visible(i + 1)) w.push(b.text(i)); return { w, b }; };

test('a drop cap written before the title is read with the first word of its paragraph', () => {
  const { rec, lines } = page([['A', 40, 400, 40], ['ALL BEHAVIOR MAKES SENSE', 40, 520, 15], ['Most debates are about lives.', 40, 490],
    ['n important question I love is: what have you seen', 70, 414], ['makes you believe what you do? And would I', 70, 400], ['believe the same if I saw it too.', 40, 386]]);
  const caps = findDropCaps(rec, lines);
  assert.equal(caps.length, 1);
  const { w, b } = words(rec, caps);
  assert.deepEqual(w.slice(0, 9), ['ALL', 'BEHAVIOR', 'MAKES', 'SENSE', 'Most', 'debates', 'are', 'about', 'lives.']);
  assert.equal(w[9], 'An');
  assert.ok(!w.includes('A') && !w.includes('n'));
  assert.equal(b.redirect.get(caps[0][0]), caps[0][1]);   // tapping the letter picks "An"
});

test('an opening quote before the cap is kept ("“A" + "n" = "“An")', () => {
  const { rec, lines } = page([['“A', 40, 400, 40], ['n important question I love is: what have you seen', 80, 414], ['makes you believe what you do? And would I', 80, 400]]);
  assert.deepEqual(words(rec, findDropCaps(rec, lines)).w.slice(0, 2), ['“An', 'important']);
});

test('negative: large letters that are not drop caps stay as they are', () => {
  const cases = {
    'chapter numeral centred above the text': [['I', 200, 470, 40], ['The story begins here on a quiet morning in town,', 40, 414], ['and it goes on for a while.', 40, 400]],
    'normal-size single letter': [['A', 40, 414], ['n important question I love is: what have you seen', 52, 414]],
    'big letter far left of the text': [['A', 10, 400, 40], ['n important question I love is: what have you seen', 200, 414]],
    'big letter above the text, not beside it': [['A', 40, 470, 40], ['n important question I love is: what have you seen', 70, 414]],
  };
  for (const [name, items] of Object.entries(cases)) {
    const { rec, lines } = page(items);
    assert.deepEqual(findDropCaps(rec, lines), [], name);
  }
});

test('no caps stored: a page reads exactly as before', () => {
  const { rec } = page([['Plain text on a page.', 40, 400]]);
  assert.deepEqual(words(rec, undefined).w, ['Plain', 'text', 'on', 'a', 'page.']);
});

test('ellipsis between two words splits them; the first part pauses like a sentence end', () => {
  for (const [s, e] of [['odjednom...polete', ['odjednom...', 'polete']], ['wait…what', ['wait…', 'what']], ['Čekaj....Šta?', ['Čekaj....', 'Šta?']]]) {
    const t = tokenize(s);
    assert.deepEqual(t.map(x => x.text), e, s);
    assert.ok(t[0].flags & F.SENT, s);
  }
  for (const s of ['3...5', 'www.a...b', 'https://x.org/a...b']) assert.equal(tokenize(s).length, 1, s);   // numbers and web addresses stay whole
});

test('a cap that is a word of its own ("I" + "once") is not glued, but still read in its place', () => {
  // "once" also occurs elsewhere in the book, "ionce" never: the letter is the word "I"
  const { rec, lines } = page([['I', 40, 400, 40], ['UTILITY VS. STATUS', 40, 520, 15],
    ['once heard someone say that a nicer car is', 70, 414], ['plush and quiet, and once you drive it', 70, 400], ['you know it at once.', 40, 386]]);
  const { w } = words(rec, findDropCaps(rec, lines));
  assert.deepEqual(w.slice(0, 5), ['UTILITY', 'VS.', 'STATUS', 'I once', 'heard']);
});

test('N7: "M AYBE" in a heading is read as "MAYBE"; "A MAN" stays two words', () => {
  const b = new Book({ id: 'x', title: 't' }, [buildPage('M AYBE YOU HAVE ENOUGH\n\nMaybe you do, and maybe not. A MAN WALKS IN\n\nThe man sat.', true)]);
  const w = []; for (let i = b.visible(0); i < b.length; i = b.visible(i + 1)) w.push(b.text(i));
  assert.deepEqual(w.slice(0, 4), ['MAYBE', 'YOU', 'HAVE', 'ENOUGH']);
  assert.ok(w.includes('A') && w.includes('MAN'));
});

test('N6: control characters from a font without a text mapping are not read as words, offsets stay aligned', () => {
  const items = [{ str: 'fall.', transform: [11, 0, 0, 11, 40, 400], width: 30, hasEOL: true }, { str: '—\u0000\u0000\u0000 \u0000\u0000', transform: [11, 0, 0, 11, 40, 386], width: 40, hasEOL: true },
    { str: 'Greed and fear', transform: [11, 0, 0, 11, 40, 372], width: 80, hasEOL: true }];
  const ex = extractLines(items);
  assert.ok(!/[\u0000-\u001F]/.test(ex.text.replace(/\n/g, '')));
  assert.equal(ex.text.length, items.reduce((n, it) => n + it.str.length + 1, 0));   // same length: text layer offsets still match
  assert.deepEqual(tokenize(ex.text).map(t => t.text), ['fall.—', 'Greed', 'and', 'fear']);
});
