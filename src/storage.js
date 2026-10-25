// SPDX-License-Identifier: AGPL-3.0-only
// IndexedDB opening with versioned migrations (CONTROLS.md ARH-02).
//
// Rules for changing the schema:
//  1. Never edit a migration that has shipped. Add a new entry with the next version number.
//  2. A migration runs inside the upgrade transaction: if it throws, the whole upgrade is rolled back and the
//     database stays at its previous version with all data intact.
//  3. Migrations must work from every older version, because users skip versions.

// The schema of this app. Index = version - 1.
export const MIGRATIONS = Object.freeze([
  // v1: initial schema (identical to the stores created by every release so far)
  (db) => {
    db.createObjectStore('documents', { keyPath: 'id' });
    db.createObjectStore('files', { keyPath: 'docId' });
    db.createObjectStore('pages', { keyPath: ['docId', 'pageIndex'] });
    db.createObjectStore('progress', { keyPath: 'docId' });
  },
]);

// Which migrations to run when upgrading from `oldVersion` (0 = new database) to `target`.
export function migrationPlan(oldVersion, target, migrations = MIGRATIONS) {
  if (!Number.isInteger(target) || target < 1 || target > migrations.length) throw new Error(`No migration for version ${target}`);
  if (!Number.isInteger(oldVersion) || oldVersion < 0) throw new Error(`Invalid stored version ${oldVersion}`);
  const steps = [];
  for (let v = oldVersion + 1; v <= target; v++) steps.push(v);
  return steps;
}

// Opens the database at `migrations.length`, running the missing migrations.
// - Another tab with an older version open: we wait (onBlocked tells the UI), we do not fail.
// - This tab is open when a newer tab upgrades: the connection closes itself (onVersionChange tells the UI).
// - The database is NEWER than this code (e.g. after rolling back the app): it is opened at its own version,
//   unchanged, and `newer` is set so the UI can say so. Stores this code knows keep working.
export function openDatabase(name, { migrations = MIGRATIONS, onBlocked, onVersionChange, idb = globalThis.indexedDB } = {}) {
  const target = migrations.length;
  const wire = (db, newer) => {
    db.onversionchange = () => { db.close(); onVersionChange && onVersionChange(); };
    return { db, newer, version: db.version };
  };
  return new Promise((resolve, reject) => {
    let req;
    try { req = idb.open(name, target); } catch (e) { reject(e); return; }
    req.onupgradeneeded = (e) => {
      const db = req.result, tx = req.transaction;
      try {
        for (const v of migrationPlan(e.oldVersion, target, migrations)) migrations[v - 1](db, tx, e.oldVersion);
      } catch (err) {
        tx.abort();             // nothing of this upgrade is kept
        reject(err);
      }
    };
    req.onblocked = () => { onBlocked && onBlocked(); };          // keep waiting: the request completes once others close
    req.onsuccess = () => resolve(wire(req.result, false));
    req.onerror = (ev) => {
      const err = req.error;
      if (err && err.name === 'VersionError') {
        ev.preventDefault();
        const again = idb.open(name);                             // current version, no upgrade
        again.onsuccess = () => resolve(wire(again.result, true));
        again.onerror = () => reject(again.error);
        return;
      }
      reject(err);
    };
  });
}
