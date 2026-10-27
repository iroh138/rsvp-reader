// SPDX-License-Identifier: AGPL-3.0-only
// Library backup (DEX-01): a plain ZIP file (stored, not compressed) that any ZIP tool can open.
//   library.json      app name, format version, the books, reading positions and settings
//   books/<n>.pdf     the original PDF files, byte for byte
// Restoring re-imports every PDF through the normal import path, so nothing processed is taken from the file.
// Everything read from a backup file is untrusted: the reader accepts only the shape this writer produces.
// Pure functions, no DOM; tested in Node (tests/backup.test.mjs).
import { parsePositionsExport } from './settings.js';

export const BACKUP = Object.freeze({
  manifest: 'library.json',
  maxBooks: 2000,
  maxBookBytes: 200 * 1024 * 1024,      // same limit as importing a PDF
  maxManifestBytes: 2_000_000,
  maxTotalBytes: 0xFFFFFFFF - 1,         // classic ZIP (no ZIP64): offsets and sizes are 32-bit
});

// ---- CRC-32 (IEEE, as used by ZIP) ----
const TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
export function crc32Update(crc, bytes) {
  let c = ~crc >>> 0;
  for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return ~c >>> 0;
}
export const crc32 = (bytes) => crc32Update(0, bytes);

const enc = new TextEncoder();
const u16 = (v, o, n) => v.setUint16(o, n, true);
const u32 = (v, o, n) => v.setUint32(o, n >>> 0, true);
// Fixed timestamp (1980-01-01 00:00): the archive does not need one, and it keeps backups reproducible.
const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1;

// entries: [{ name, size, crc, data }] where data is anything a Blob accepts (Uint8Array, Blob).
// Returns the parts of the ZIP file in order; the caller wraps them in a Blob, so large PDFs are never copied.
export function zipParts(entries) {
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name);
    const h = new DataView(new ArrayBuffer(30));
    u32(h, 0, 0x04034b50); u16(h, 4, 20); u16(h, 6, 0x0800); u16(h, 8, 0);   // UTF-8 names, stored
    u16(h, 10, DOS_TIME); u16(h, 12, DOS_DATE); u32(h, 14, e.crc); u32(h, 18, e.size); u32(h, 22, e.size);
    u16(h, 26, name.length); u16(h, 28, 0);
    parts.push(new Uint8Array(h.buffer), name, e.data);
    const c = new DataView(new ArrayBuffer(46));
    u32(c, 0, 0x02014b50); u16(c, 4, 20); u16(c, 6, 20); u16(c, 8, 0x0800); u16(c, 10, 0);
    u16(c, 12, DOS_TIME); u16(c, 14, DOS_DATE); u32(c, 16, e.crc); u32(c, 20, e.size); u32(c, 24, e.size);
    u16(c, 28, name.length); u16(c, 30, 0); u16(c, 32, 0); u16(c, 34, 0); u16(c, 36, 0); u32(c, 38, 0); u32(c, 42, offset);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + e.size;
    if (offset > BACKUP.maxTotalBytes) throw userError('The library is too large for one backup file (more than 4 GB).');
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  u32(end, 0, 0x06054b50); u16(end, 8, entries.length); u16(end, 10, entries.length); u32(end, 12, cdSize); u32(end, 16, offset); u16(end, 20, 0);
  return [...parts, ...central, new Uint8Array(end.buffer)];
}

export function libraryManifest({ books, positions, settings }, now = Date.now()) {
  return JSON.stringify({ app: 'rsvp-reader', kind: 'library', v: 1, createdAt: now,
    books: books.map((b, i) => ({ file: `books/${i + 1}.pdf`, id: b.id, title: b.title, fileName: b.fileName })), positions, settings }, null, 1);
}

// ---- Reading: only the archive shape that zipParts writes ----
const BAD = 'This file is not a library backup from this app, or it is damaged.';

// tail: the last bytes of the file (at least 22; the end record must be inside, there is no comment).
// Returns { count, cdOffset, cdSize } after checking them against the file size.
export function readEnd(tail, fileSize) {
  if (!(tail instanceof Uint8Array) || tail.length < 22) throw userError(BAD);
  const v = new DataView(tail.buffer, tail.byteOffset + tail.length - 22, 22);
  if (v.getUint32(0, true) !== 0x06054b50 || v.getUint16(20, true) !== 0) throw userError(BAD);
  const count = v.getUint16(10, true), cdSize = v.getUint32(12, true), cdOffset = v.getUint32(16, true);
  if (v.getUint16(4, true) || v.getUint16(6, true) || v.getUint16(8, true) !== count) throw userError(BAD);   // single disk
  if (count < 1 || count > BACKUP.maxBooks + 1 || cdOffset + cdSize !== fileSize - 22) throw userError(BAD);
  return { count, cdOffset, cdSize };
}

// cd: the central directory bytes. Returns [{ name, offset, size, crc, dataOffset }] with dataOffset computed from
// the name length (this writer never adds extra fields; the local header is re-checked by checkLocal before use).
export function readCentral(cd, { count, cdOffset }) {
  const v = new DataView(cd.buffer, cd.byteOffset, cd.length);
  const dec = new TextDecoder('utf-8', { fatal: true });
  const out = [], names = new Set();
  let p = 0, expect = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== 0x02014b50) throw userError(BAD);
    const method = v.getUint16(p + 10, true), crc = v.getUint32(p + 16, true), csize = v.getUint32(p + 20, true), size = v.getUint32(p + 24, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true), offset = v.getUint32(p + 42, true);
    if (method !== 0 || csize !== size || xlen || clen || (v.getUint16(p + 8, true) & 1)) throw userError(BAD);   // stored, unencrypted
    if (p + 46 + nlen > cd.length) throw userError(BAD);
    let name;
    try { name = dec.decode(cd.subarray(p + 46, p + 46 + nlen)); } catch { throw userError(BAD); }
    const ok = name === BACKUP.manifest || /^books\/[1-9][0-9]{0,4}\.pdf$/.test(name);
    if (!ok || names.has(name)) throw userError(BAD);
    names.add(name);
    const max = name === BACKUP.manifest ? BACKUP.maxManifestBytes : BACKUP.maxBookBytes;
    // entries are back to back, in order, ending where the central directory starts: no overlaps, no gaps
    if (size > max || offset !== expect) throw userError(BAD);
    const dataOffset = offset + 30 + nlen;
    expect = dataOffset + size;
    out.push({ name, offset, size, crc, dataOffset });
    p += 46 + nlen;
  }
  if (p !== cd.length || expect !== cdOffset || !names.has(BACKUP.manifest)) throw userError(BAD);
  return out;
}

// local: the 30-byte local header + name of an entry; must agree with the central directory.
export function checkLocal(local, entry) {
  const v = new DataView(local.buffer, local.byteOffset, local.length);
  const nlen = local.length >= 30 ? v.getUint16(26, true) : -1;
  const ok = local.length === 30 + enc.encode(entry.name).length && v.getUint32(0, true) === 0x04034b50 && v.getUint16(8, true) === 0
    && v.getUint32(14, true) === entry.crc && v.getUint32(18, true) === entry.size && v.getUint32(22, true) === entry.size
    && nlen === local.length - 30 && v.getUint16(28, true) === 0 && new TextDecoder().decode(local.subarray(30)) === entry.name;
  if (!ok) throw userError(BAD);
}

// Validates library.json against the files in the archive. Positions and settings go through the same checks
// as pasted reading positions. Returns { books: [{ file, id, title, fileName }], positions, settings, skipped }.
export function parseLibraryManifest(text, fileNames, now = Date.now()) {
  if (typeof text !== 'string' || text.length > BACKUP.maxManifestBytes) throw userError(BAD);
  let data;
  try { data = JSON.parse(text); } catch { throw userError(BAD); }
  if (!data || typeof data !== 'object' || data.app !== 'rsvp-reader' || data.kind !== 'library' || !Array.isArray(data.books)) throw userError(BAD);
  if (data.v !== 1) throw userError('This backup comes from a newer version of the app. Update the app, then restore it.');
  if (data.books.length > BACKUP.maxBooks) throw userError(BAD);
  const files = new Set(fileNames), seen = new Set(), books = [];
  let skipped = 0;
  for (const b of data.books) {
    const ok = b && typeof b === 'object' && typeof b.file === 'string' && files.has(b.file) && !seen.has(b.file)
      && typeof b.id === 'string' && b.id.length > 0 && b.id.length <= 512;
    if (!ok) { skipped++; continue; }
    seen.add(b.file);
    const str = (s, n) => typeof s === 'string' ? s.slice(0, n) : '';
    books.push({ file: b.file, id: b.id, title: str(b.title, 500), fileName: str(b.fileName, 500) });
  }
  const pos = parsePositionsExport(JSON.stringify({ app: 'rsvp-reader', v: 1, positions: Array.isArray(data.positions) ? data.positions : [], settings: data.settings }), now);
  return { books, positions: pos.positions, settings: pos.settings, skipped: skipped + pos.skipped };
}

function userError(msg) { const e = new Error(msg); e.user = true; return e; }
