// SPDX-License-Identifier: AGPL-3.0-only
// SEC-03 / SEC-06 / threat model P1-A1 (CVE-2024-4367: arbitrary JavaScript through a crafted font in pdf.js <= 4.1.392).
// Up to pdf.js 3.x the mitigation was `isEvalSupported: false` on every getDocument call. pdf.js 4.2.67 removed the
// eval-based font path altogether (the option no longer exists), so the check is now on the vendored library itself.
// Static checks only: no exploit file is used or needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
const lib = await readFile(new URL('../vendor/pdfjs/pdf.min.mjs', import.meta.url), 'utf8');
const worker = await readFile(new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url), 'utf8');

export function getDocumentCalls(src) {
  const calls = [];
  for (const m of src.matchAll(/getDocument\s*\(/g)) {
    let depth = 0, i = m.index + m[0].length - 1;
    for (; i < src.length; i++) { if (src[i] === '(') depth++; else if (src[i] === ')' && --depth === 0) break; }
    calls.push(src.slice(m.index, i + 1));
  }
  return calls;
}
export function versionAtLeast(v, min) {
  const a = v.split('.').map(Number), b = min.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  return true;
}

test('the vendored pdf.js is at least 4.2.67 (first release without the CVE-2024-4367 eval font path)', () => {
  const m = lib.match(/apiVersion:"(\d+\.\d+\.\d+)"/);
  assert.ok(m, 'pdf.js version not found in vendor/pdfjs/pdf.min.mjs');
  assert.ok(versionAtLeast(m[1], '4.2.67'), `pdf.js ${m[1]} is older than 4.2.67`);
});

test('neither the library nor the worker contains the eval font path or its switch', () => {
  for (const [name, src] of [['pdf.min.mjs', lib], ['pdf.worker.min.mjs', worker]]) {
    assert.ok(!src.includes('isEvalSupported'), `${name} still has isEvalSupported`);
    assert.ok(!/FontLoader[^;]{0,200}new Function/.test(src), `${name} compiles fonts with new Function`);
  }
});

test('negative: the version check rejects the vulnerable releases', () => {
  assert.equal(versionAtLeast('3.11.174', '4.2.67'), false);
  assert.equal(versionAtLeast('4.1.392', '4.2.67'), false);
  assert.equal(versionAtLeast('4.2.67', '4.2.67'), true);
  assert.equal(versionAtLeast('6.4.299', '4.2.67'), true);
});

test('PDFs are only opened from bytes in memory, never from a URL, and wasm comes from this origin', () => {
  const calls = getDocumentCalls(app);
  assert.equal(calls.length, 3, 'the three known call sites');
  for (const c of calls) {
    assert.match(c, /getDocument\(\{\s*data\b/, c);
    assert.match(c, /wasmUrl:\s*PDFJS_WASM/, c);
  }
  assert.match(app, /const PDFJS_WASM = new URL\('vendor\/pdfjs\/wasm\/', location\.href\)\.href/);
});

test('the PDF JavaScript engine (quickjs-eval) is not shipped', async () => {
  const sums = await readFile(new URL('../vendor/SHA256SUMS', import.meta.url), 'utf8');
  assert.ok(!/quickjs/.test(sums));
});
