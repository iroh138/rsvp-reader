// SPDX-License-Identifier: AGPL-3.0-only
// N8 (docs/pdf-corpus.md): a word divided at the end of a line is read as one word, however the PDF writes the
// line end and the hyphen. Each case below was read as two words before the fix (except the first).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractLines, tokenize, buildPage, Book } from '../src/core.js';

const it = (str, y, eol) => ({ str, transform: [11, 0, 0, 11, 40, y], width: str.length * 5, hasEOL: eol });
const read = (items) => tokenize(extractLines(items).text).map(t => t.text);

test('line-end hyphen: every way a PDF writes it gives one word', () => {
  const cases = {
    'end-of-line mark after the hyphen (already worked)': [it('an impor-', 400, true), it('tant word.', 386, true)],
    'no end-of-line mark, next line found by position': [it('an impor-', 400, false), it('tant word.', 386, false)],
    'trailing space item, no end-of-line mark': [it('an impor-', 400, false), it(' ', 400, false), it('tant word.', 386, false)],
    'typographic hyphen U+2010': [it('an impor‐', 400, true), it('tant word.', 386, true)],
    'soft hyphen U+00AD': [it('an impor­', 400, true), it('tant word.', 386, true)],
  };
  for (const [name, items] of Object.entries(cases)) assert.deepEqual(read(items), ['an', 'important', 'word.'], name);
});

test('not joined: a capital after the hyphen, a hyphen inside a line, a new paragraph', () => {
  assert.deepEqual(read([it('the North-', 400, true), it('West wind', 386, true)]), ['the', 'North-', 'West', 'wind']);
  assert.deepEqual(read([it('a well-known fact', 400, true)]), ['a', 'well-known', 'fact']);
  assert.deepEqual(tokenize('the end-\n\nnew paragraph').map(t => t.text), ['the', 'end-', 'new', 'paragraph']);
});

test('the line break inserted for a line without an end-of-line mark keeps item offsets in order', () => {
  const ex = extractLines([it('an impor-', 400, false), it('tant word.', 386, false)]);
  assert.equal(ex.text, 'an impor-\ntant word.');
  assert.deepEqual(ex.itemStarts, [0, 10]);                       // the second item starts after the inserted break
  assert.equal(ex.text.slice(ex.itemStarts[1], ex.itemStarts[1] + 4), 'tant');
});

test('U+2010 and soft hyphen at a page break are joined too', () => {
  for (const h of ['-', '‐', '­']) {
    const b = new Book({ id: 'x', title: 't' }, [buildPage(`page one ends with extra${h}`, false), buildPage('ordinary words.', true)]);
    const w = []; for (let i = b.visible(0); i < b.length; i = b.visible(i + 1)) w.push(b.text(i));
    assert.deepEqual(w, ['page', 'one', 'ends', 'with', 'extraordinary', 'words.'], JSON.stringify(h));
  }
});

test('a long web address without https:// is not cut at its hyphens', () => {
  assert.deepEqual(tokenize('see thecut.com/article/how-someone-gets-it-done.html today').map(t => t.text),
    ['see', 'thecut.com/article/how-someone-gets-it-done.html', 'today']);
  // long compounds are still cut, as before, so each piece fits the reading window
  assert.deepEqual(tokenize('great-great-great-grandmother').map(t => t.text), ['great-', 'great-', 'great-', 'grandmother']);
});
