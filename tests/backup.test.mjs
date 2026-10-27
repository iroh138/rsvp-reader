// SPDX-License-Identifier: AGPL-3.0-only
// DEX-01: library backup format. Round trip, interoperability with standard ZIP tools, and rejection of
// anything this writer would not produce (the file comes from outside the app and is untrusted).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, crc32Update, zipParts, libraryManifest, readEnd, readCentral, checkLocal, parseLibraryManifest, BACKUP } from '../src/backup.js';

const te = new TextEncoder();
const entry = (name, bytes) => ({ name, size: bytes.length, crc: crc32(bytes), data: bytes });
const pdfA = te.encode('%PDF-1.4 first book ' + 'a'.repeat(1000));
const pdfB = te.encode('%PDF-1.7 second book ćirilica ђ');
const manifest = libraryManifest({
  books: [{ id: 'aa11', title: 'Prva knjiga', fileName: 'prva.pdf' }, { id: 'bb22', title: 'Друга', fileName: 'druga.pdf' }],
  positions: [{ id: 'aa11', title: 'Prva knjiga', tokenIndex: 120, updatedAt: 1700000000000 }],
  settings: { wpm: 350, sent: 2.5, skipRunning: true, showImages: false },
}, 1700000000000);
async function build(entries) { return new Uint8Array(await new Blob(zipParts(entries)).arrayBuffer()); }
const good = () => build([entry('library.json', te.encode(manifest)), entry('books/1.pdf', pdfA), entry('books/2.pdf', pdfB)]);

// Reads an archive the way the app does: end record, central directory, local headers, data.
function read(zip) {
  const end = readEnd(zip.subarray(zip.length - 22), zip.length);
  const entries = readCentral(zip.subarray(end.cdOffset, end.cdOffset + end.cdSize), end);
  for (const e of entries) checkLocal(zip.subarray(e.offset, e.dataOffset), e);
  return entries.map(e => ({ ...e, bytes: zip.subarray(e.dataOffset, e.dataOffset + e.size) }));
}

test('crc32 matches the standard check value; chunked update equals one pass', () => {
  assert.equal(crc32(te.encode('123456789')), 0xCBF43926);
  const all = te.encode('The quick brown fox jumps over the lazy dog');
  assert.equal(crc32Update(crc32(all.subarray(0, 10)), all.subarray(10)), crc32(all));
});

test('round trip: every entry comes back byte for byte, with a matching CRC', async () => {
  const got = read(await good());
  assert.deepEqual(got.map(e => e.name), ['library.json', 'books/1.pdf', 'books/2.pdf']);
  assert.deepEqual(got[1].bytes, pdfA);
  assert.deepEqual(got[2].bytes, pdfB);
  for (const e of got) assert.equal(crc32(e.bytes), e.crc);
  const m = parseLibraryManifest(new TextDecoder().decode(got[0].bytes), got.map(e => e.name), 1800000000000);
  assert.deepEqual(m.books.map(b => [b.file, b.id, b.title]), [['books/1.pdf', 'aa11', 'Prva knjiga'], ['books/2.pdf', 'bb22', 'Друга']]);
  assert.deepEqual(m.positions, [{ id: 'aa11', tokenIndex: 120, updatedAt: 1700000000000 }]);
  assert.equal(m.settings.wpm, 350);
  assert.equal(m.skipped, 0);
});

test('standard ZIP tools read the backup (python zipfile: names, contents, CRC test)', async (t) => {
  let py;
  try { py = execFileSync('python3', ['--version']); } catch { t.skip('python3 not available'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const file = join(dir, 'library.zip');
  writeFileSync(file, await good());
  const out = execFileSync('python3', ['-I', '-c', `
import zipfile, sys, json, hashlib
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None
print(json.dumps({i.filename: [i.compress_type, hashlib.sha256(z.read(i)).hexdigest()] for i in z.infolist()}))`, file]).toString();
  const got = JSON.parse(out);
  const sha = (b) => execFileSync('python3', ['-I', '-c', 'import hashlib,sys;print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())', b]).toString().trim();
  writeFileSync(join(dir, 'a'), pdfA);
  assert.deepEqual(Object.keys(got), ['library.json', 'books/1.pdf', 'books/2.pdf']);
  assert.equal(got['books/1.pdf'][0], 0);   // stored
  assert.equal(got['books/1.pdf'][1], sha(join(dir, 'a')));
});

test('a ZIP made by another tool is refused (compressed entries)', async (t) => {
  try { execFileSync('python3', ['--version']); } catch { t.skip('python3 not available'); return; }
  const dir = mkdtempSync(join(tmpdir(), 'bk-'));
  const file = join(dir, 'other.zip');
  execFileSync('python3', ['-I', '-c', `
import zipfile, sys
with zipfile.ZipFile(sys.argv[1], 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('library.json', sys.argv[2]); z.writestr('books/1.pdf', b'%PDF-1.4 ' + b'x' * 500)`, file, manifest]);
  const zip = new Uint8Array(readFileSync(file));
  assert.throws(() => read(zip), /not a library backup/);
});

test('malformed or hostile archives are refused', async () => {
  const cases = {
    'not a zip': te.encode('%PDF-1.4 just a pdf, renamed to .zip, long enough to have twenty-two bytes'),
    'too short': new Uint8Array(10),
    'path traversal name': await build([entry('library.json', te.encode(manifest)), entry('../evil.pdf', pdfA)]),
    'absolute path name': await build([entry('library.json', te.encode(manifest)), entry('/books/1.pdf', pdfA)]),
    'unexpected file': await build([entry('library.json', te.encode(manifest)), entry('books/1.exe', pdfA)]),
    'duplicate name': await build([entry('library.json', te.encode(manifest)), entry('books/1.pdf', pdfA), entry('books/1.pdf', pdfB)]),
    'no library.json': await build([entry('books/1.pdf', pdfA)]),
    'trailing bytes': new Uint8Array([...await good(), 0, 0, 0]),
  };
  // central directory claims a different size than the local header (e.g. a truncated or edited entry)
  const lying = await good();
  const end = readEnd(lying.subarray(lying.length - 22), lying.length);
  new DataView(lying.buffer).setUint32(end.cdOffset + 46 + 'library.json'.length + 24, pdfA.length + 1, true);
  cases['size mismatch'] = lying;
  // CRC in the central directory differs from the local header
  const crc = await good();
  new DataView(crc.buffer).setUint32(end.cdOffset + 16, 1234, true);
  cases['crc mismatch'] = crc;
  for (const [name, zip] of Object.entries(cases)) assert.throws(() => read(zip), /not a library backup/, name);
});

test('library.json: wrong app, newer version, missing files and bad values', () => {
  const files = ['library.json', 'books/1.pdf'];
  const base = { app: 'rsvp-reader', kind: 'library', v: 1, books: [{ file: 'books/1.pdf', id: 'aa' }], positions: [], settings: {} };
  const t = (o) => JSON.stringify({ ...base, ...o });
  assert.throws(() => parseLibraryManifest('{not json', files), /not a library backup/);
  assert.throws(() => parseLibraryManifest(t({ app: 'other' }), files), /not a library backup/);
  assert.throws(() => parseLibraryManifest(t({ kind: 'positions' }), files), /not a library backup/);
  assert.throws(() => parseLibraryManifest(t({ v: 2 }), files), /newer version/);
  // a book pointing at a file that is not in the archive, a duplicate, and an invalid id are skipped, not fatal
  const m = parseLibraryManifest(t({ books: [{ file: 'books/1.pdf', id: 'aa' }, { file: 'books/9.pdf', id: 'bb' }, { file: 'books/1.pdf', id: 'cc' }, { file: 'books/1.pdf', id: 5 }],
    positions: [{ id: 'aa', tokenIndex: -1 }], settings: { wpm: '900' } }), files);
  assert.equal(m.books.length, 1);
  assert.equal(m.skipped, 4);   // 3 books + 1 position
  assert.equal(m.settings.wpm, undefined);   // invalid setting dropped by the same rules as pasted positions
  assert.equal(parseLibraryManifest(t({ books: [{ file: 'books/1.pdf', id: 'aa', title: 'x'.repeat(5000) }] }), files).books[0].title.length, 500);
});

test('size limits match the PDF import limit', () => {
  assert.equal(BACKUP.maxBookBytes, 200 * 1024 * 1024);
});
