// SPDX-License-Identifier: AGPL-3.0-only
// Validation of untrusted settings and reading-position imports (CONTROLS.md SEC-03, threat model P2).
// Pure functions, no DOM or storage access.

export const LIMITS = Object.freeze({
  wpm: Object.freeze([100, 1000]),       // T3.1
  sent: Object.freeze([1.5, 4]),         // T3.3, slider step 0.25
  sentStep: 0.25,
  maxImportChars: 2_000_000,             // a real export is ~100 bytes per book
  maxPositions: 10_000,
  maxIdLength: 512,                      // ids are SHA-256 hex (64) or "name|size|mtime"
});

const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

// Returns only the known settings keys whose values are valid; numbers are clamped to their range.
export function sanitizeSettings(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const own = k => Object.prototype.hasOwnProperty.call(raw, k);
  if (own('wpm') && isNum(raw.wpm)) out.wpm = Math.round(clamp(raw.wpm, LIMITS.wpm));
  if (own('sent') && isNum(raw.sent)) out.sent = clamp(Math.round(raw.sent / LIMITS.sentStep) * LIMITS.sentStep, LIMITS.sent);
  for (const k of ['skipRunning', 'showImages']) if (own(k) && typeof raw[k] === 'boolean') out[k] = raw[k];
  return out;
}

function userError(message) { const e = new Error(message); e.user = true; return e; }

// Parses the text produced by "Copy reading positions". Throws an Error with .user = true for input that is not
// an export of this app; skips (and counts) individual entries that are invalid.
export function parsePositionsExport(text, now = Date.now()) {
  if (typeof text !== 'string' || text.length > LIMITS.maxImportChars) throw userError('That text is too long to be a list of reading positions.');
  let data;
  try { data = JSON.parse(text); } catch { throw userError('That text is not a list of reading positions. Copy it again with “Copy reading positions”.'); }
  if (!data || typeof data !== 'object' || data.app !== 'rsvp-reader' || !Array.isArray(data.positions)) throw userError('That text is not a list of reading positions from this app.');
  if (data.v !== 1) throw userError('These reading positions come from a different version of the app.');
  if (data.positions.length > LIMITS.maxPositions) throw userError(`That list has more than ${LIMITS.maxPositions} books.`);
  const positions = [];
  let skipped = 0;
  for (const p of data.positions) {
    const ok = p && typeof p === 'object' && typeof p.id === 'string' && p.id.length > 0 && p.id.length <= LIMITS.maxIdLength
      && Number.isSafeInteger(p.tokenIndex) && p.tokenIndex >= 0;
    if (!ok) { skipped++; continue; }
    const t = isNum(p.updatedAt) && p.updatedAt > 0 ? Math.min(p.updatedAt, now) : now;   // a future time would always win
    positions.push({ id: p.id, tokenIndex: p.tokenIndex, updatedAt: t });
  }
  return { positions, settings: sanitizeSettings(data.settings), skipped, total: data.positions.length };
}
