// SPDX-License-Identifier: AGPL-3.0-only
// SEC-03 / T3.8: imported or stored settings and reading positions are untrusted input.
// Expected values come from docs/phase-1/02-zahtevi.md (T3.1 wpm 100-1000; T3.3 sentence pause 1.5-4x)
// and docs/threat-model.md P2 (A5-A7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSettings, parsePositionsExport, LIMITS } from '../src/settings.js';

const NOW = 1_800_000_000_000;
const exp = (positions, settings) => JSON.stringify({ app: 'rsvp-reader', v: 1, positions, settings });

test('limits match the requirements', () => {
  assert.deepEqual(LIMITS.wpm, [100, 1000]);
  assert.deepEqual(LIMITS.sent, [1.5, 4]);
});

test('valid settings pass through unchanged', () => {
  assert.deepEqual(sanitizeSettings({ wpm: 325, sent: 2.75, skipRunning: false, showImages: true }),
    { wpm: 325, sent: 2.75, skipRunning: false, showImages: true });
});

test('A5: out-of-range numbers are clamped to the allowed range', () => {
  assert.deepEqual(sanitizeSettings({ wpm: -100, sent: 1e9 }), { wpm: 100, sent: 4 });
  assert.deepEqual(sanitizeSettings({ wpm: 50000, sent: 0 }), { wpm: 1000, sent: 1.5 });
});

test('A5: non-numbers, NaN and Infinity are dropped, not stored', () => {
  for (const bad of ['fast', '300', NaN, Infinity, -Infinity, null, [], {}, true]) {
    assert.deepEqual(sanitizeSettings({ wpm: bad, sent: bad }), {}, String(bad));
  }
});

test('sentence pause snaps to the slider step (0.25) and wpm to whole numbers', () => {
  assert.deepEqual(sanitizeSettings({ wpm: 312.7, sent: 2.6 }), { wpm: 313, sent: 2.5 });
});

test('switches accept only real booleans', () => {
  assert.deepEqual(sanitizeSettings({ skipRunning: 'false', showImages: 0 }), {});
  assert.deepEqual(sanitizeSettings({ skipRunning: true }), { skipRunning: true });
});

test('unknown keys are ignored (no injection of other stored state)', () => {
  assert.deepEqual(sanitizeSettings({ current: { kind: 'doc', id: 'x' }, text: 'evil', __proto__: { wpm: 999 } }), {});
  assert.deepEqual(sanitizeSettings(null), {});
  assert.deepEqual(sanitizeSettings('wpm=300'), {});
});

test('a valid export round-trips', () => {
  const id = 'a'.repeat(64);
  const r = parsePositionsExport(exp([{ id, title: 'Book', tokenIndex: 1234, updatedAt: NOW - 1000 }], { wpm: 400 }), NOW);
  assert.deepEqual(r.positions, [{ id, tokenIndex: 1234, updatedAt: NOW - 1000 }]);
  assert.deepEqual(r.settings, { wpm: 400 });
  assert.equal(r.skipped, 0);
  assert.equal(r.total, 1);
});

test('not JSON, wrong app or wrong shape is rejected with a user message', () => {
  for (const t of ['', 'hello', '{"app":"other","v":1,"positions":[]}', '{"app":"rsvp-reader","v":1,"positions":{}}', '[]', 'null']) {
    assert.throws(() => parsePositionsExport(t, NOW), e => e.user === true && typeof e.message === 'string', t);
  }
});

test('an unknown format version is rejected', () => {
  assert.throws(() => parsePositionsExport(JSON.stringify({ app: 'rsvp-reader', v: 2, positions: [] }), NOW), e => e.user === true);
});

test('A6: oversized text and too many entries are rejected before any work', () => {
  assert.throws(() => parsePositionsExport(' '.repeat(LIMITS.maxImportChars + 1), NOW), e => e.user === true);
  const many = Array.from({ length: LIMITS.maxPositions + 1 }, (_, i) => ({ id: 'id' + i, tokenIndex: 0, updatedAt: 1 }));
  assert.throws(() => parsePositionsExport(exp(many), NOW), e => e.user === true);
});

test('A7: invalid entries are skipped and counted', () => {
  const r = parsePositionsExport(exp([
    { id: 'ok', tokenIndex: 5, updatedAt: 10 },
    { id: 42, tokenIndex: 5 },                       // id not a string
    { id: '', tokenIndex: 5 },                       // empty id
    { id: 'x'.repeat(513), tokenIndex: 5 },          // id too long
    { id: 'neg', tokenIndex: -1 },
    { id: 'frac', tokenIndex: 1.5 },
    { id: 'str', tokenIndex: '7' },
    { id: 'big', tokenIndex: 2 ** 53 },
    null, 'text',
  ]), NOW);
  assert.deepEqual(r.positions.map(p => p.id), ['ok']);
  assert.equal(r.skipped, 9);
  assert.equal(r.total, 10);
});

test('a missing or invalid timestamp becomes "now"; a future timestamp is capped at now', () => {
  const r = parsePositionsExport(exp([
    { id: 'none', tokenIndex: 1 },
    { id: 'bad', tokenIndex: 1, updatedAt: 'yesterday' },
    { id: 'future', tokenIndex: 1, updatedAt: NOW + 10 ** 12 },
  ]), NOW);
  assert.deepEqual(r.positions.map(p => p.updatedAt), [NOW, NOW, NOW]);
});

test('settings inside an export are sanitized the same way', () => {
  const r = parsePositionsExport(exp([], { wpm: 'fast', sent: 1e9, showImages: false }), NOW);
  assert.deepEqual(r.settings, { sent: 4, showImages: false });
});

test('an export without settings applies no settings', () => {
  assert.deepEqual(parsePositionsExport(exp([]), NOW).settings, {});
});
