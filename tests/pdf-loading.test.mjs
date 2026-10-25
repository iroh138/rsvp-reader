// SPDX-License-Identifier: AGPL-3.0-only
// SEC-03 / threat model P1-A1: every place that opens a PDF must disable eval in pdf.js (the documented mitigation
// for CVE-2024-4367 in pdf.js <= 4.1.392). This is a static check: no exploit file is used or needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');

export function getDocumentCalls(src) {
  const calls = [];
  for (const m of src.matchAll(/getDocument\s*\(/g)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
    calls.push(src.slice(m.index, i + 1));
  }
  return calls;
}

test('every getDocument call sets isEvalSupported: false', () => {
  const calls = getDocumentCalls(app);
  assert.ok(calls.length >= 3, `expected the three known call sites, found ${calls.length}`);
  for (const c of calls) assert.match(c, /isEvalSupported:\s*false/, c);
});

test('negative: the check notices a call without the option', () => {
  const calls = getDocumentCalls("pdfjsLib.getDocument({ data: buf, useSystemFonts: true }).promise; x.getDocument({ data, isEvalSupported: false })");
  assert.equal(calls.length, 2);
  assert.equal(calls.filter(c => /isEvalSupported:\s*false/.test(c)).length, 1);
});

test('PDFs are only opened from bytes in memory, never from a URL', () => {
  for (const c of getDocumentCalls(app)) assert.match(c, /getDocument\(\{\s*data\b/, c);
});
