// SPDX-License-Identifier: AGPL-3.0-only
// PRV-04 / NFR "privacy": the app must not reference any third-party origin in the files it ships and runs
// (HTML, CSS, app JS, service worker, font CSS). PDF.js is vendored and checked by checksum instead; it contains
// URL strings (licence, docs) but the app never asks it to fetch from them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const FILES = ['index.html', 'styles.css', 'manifest.webmanifest', 'src/app.js', 'src/core.js', 'src/settings.js', 'src/sw.template.js', 'vendor/fonts/fonts.css'];
// Allowed hosts: example.com is reserved for documentation (RFC 2606) and appears only in tokenizer test sentences.
const ALLOWED_HOSTS = new Set(['example.com']);

export function externalUrls(text) {
  const found = [];
  for (const m of text.matchAll(/(?:https?:)?\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::\d+)?[^\s"'`)<>]*/gi)) {
    if (!ALLOWED_HOSTS.has(m[1].toLowerCase())) found.push(m[0]);
  }
  return found;
}

test('shipped files reference no third-party origin', async () => {
  for (const f of FILES) {
    const text = await readFile(root + f, 'utf8');
    assert.deepEqual(externalUrls(text), [], f);
  }
});

test('the detector catches the patterns that used to be there (negative test)', () => {
  assert.equal(externalUrls('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata">').length, 1);
  assert.equal(externalUrls("const PDFJS = ['https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'];").length, 1);
  assert.equal(externalUrls('src: url(//fonts.gstatic.com/s/literata.woff2)').length, 1);
  assert.equal(externalUrls("url(./literata-latin-opsz-normal.woff2) loadScript('vendor/pdf.min.js')").length, 0);
  assert.equal(externalUrls('// a code comment. Then https://example.com in sample text').length, 0);
});

test('the service worker handles same-origin requests only', async () => {
  const sw = await readFile(root + 'src/sw.template.js', 'utf8');
  assert.ok(!/hostname\s*===/.test(sw), 'no per-host branches');
  assert.ok(/url\.origin === location\.origin/.test(sw));
});
