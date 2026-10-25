"""ARH-02 / INF-04 browser check of src/storage.js against real IndexedDB (Chromium).
Serve the REPOSITORY ROOT (not dist), e.g. `node scripts/serve.mjs . 8080`, then:
  python3 tests/e2e/storage.py http://localhost:8080/
Each scenario uses its own database name and a fresh browser context."""
import sys, json
from playwright.sync_api import sync_playwright

url = sys.argv[1]
JS = r"""
async (scenario) => {
  const { openDatabase, MIGRATIONS } = await import('/src/storage.js');
  const name = 'test-' + scenario;
  const v1 = MIGRATIONS;
  const v2 = [...MIGRATIONS, (db, tx) => {                      // a realistic next migration
    db.createObjectStore('bookmarks', { keyPath: 'id' });
    tx.objectStore('progress').createIndex('byTime', 'updatedAt');
  }];
  const broken = [...MIGRATIONS, (db) => { db.createObjectStore('half'); throw new Error('migration bug'); }];
  const put = (db, store, v) => new Promise((res, rej) => { const t = db.transaction(store, 'readwrite'); t.objectStore(store).put(v); t.oncomplete = res; t.onerror = () => rej(t.error); });
  const get = (db, store, k) => new Promise((res, rej) => { const r = db.transaction(store).objectStore(store).get(k); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const stores = db => [...db.objectStoreNames].sort();

  if (scenario === 'fresh') {
    const { db, version, newer } = await openDatabase(name, { migrations: v1 });
    const r = { version, newer, stores: stores(db) }; db.close(); return r;
  }
  if (scenario === 'upgrade') {
    let { db } = await openDatabase(name, { migrations: v1 });
    await put(db, 'progress', { docId: 'book', tokenIndex: 42, updatedAt: 5 }); db.close();
    ({ db } = await openDatabase(name, { migrations: v2 }));
    const r = { version: db.version, stores: stores(db), kept: await get(db, 'progress', 'book'),
                index: [...db.transaction('progress').objectStore('progress').indexNames] };
    db.close(); return r;
  }
  if (scenario === 'failed-upgrade') {
    let { db } = await openDatabase(name, { migrations: v1 });
    await put(db, 'progress', { docId: 'book', tokenIndex: 42, updatedAt: 5 }); db.close();
    let error = null;
    try { await openDatabase(name, { migrations: broken }); } catch (e) { error = e.message; }
    ({ db } = await openDatabase(name, { migrations: v1 }));
    const r = { error, version: db.version, stores: stores(db), kept: await get(db, 'progress', 'book') };
    db.close(); return r;
  }
  if (scenario === 'rollback') {                                // app rolled back after the database was upgraded
    let { db } = await openDatabase(name, { migrations: v2 });
    await put(db, 'progress', { docId: 'book', tokenIndex: 7, updatedAt: 5 }); db.close();
    const old = await openDatabase(name, { migrations: v1 });
    const r = { newer: old.newer, version: old.version, kept: await get(old.db, 'progress', 'book') };
    await put(old.db, 'progress', { docId: 'book', tokenIndex: 8, updatedAt: 6 });
    r.writeWorks = (await get(old.db, 'progress', 'book')).tokenIndex === 8;
    old.db.close(); return r;
  }
  if (scenario === 'other-tab') {                               // an open old connection must not block the upgrade
    let closedByUpgrade = false, blocked = false;
    const a = await openDatabase(name, { migrations: v1, onVersionChange: () => { closedByUpgrade = true; } });
    const b = await Promise.race([
      openDatabase(name, { migrations: v2, onBlocked: () => { blocked = true; } }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('upgrade still blocked after 3 s')), 3000)),
    ]);
    const r = { closedByUpgrade, blocked, version: b.version }; b.db.close(); return r;
  }
}
"""
expect = {
    'fresh': lambda r: r['version'] == 1 and not r['newer'] and r['stores'] == ['documents', 'files', 'pages', 'progress'],
    'upgrade': lambda r: r['version'] == 2 and 'bookmarks' in r['stores'] and r['kept']['tokenIndex'] == 42 and r['index'] == ['byTime'],
    'failed-upgrade': lambda r: r['error'] == 'migration bug' and r['version'] == 1 and 'half' not in r['stores'] and r['kept']['tokenIndex'] == 42,
    'rollback': lambda r: r['newer'] and r['version'] == 2 and r['kept']['tokenIndex'] == 7 and r['writeWorks'],
    'other-tab': lambda r: r['closedByUpgrade'] and r['version'] == 2,
}
out, ok = {}, True
with sync_playwright() as p:
    b = p.chromium.launch()
    for sc, check in expect.items():
        ctx = b.new_context(); pg = ctx.new_page()
        pg.goto(url + 'index.html', wait_until='domcontentloaded')
        try:
            r = pg.evaluate(JS, sc)
            r['pass'] = bool(check(r))
        except Exception as e:
            r = {'pass': False, 'exception': str(e)[:200]}
        ok &= r['pass']; out[sc] = r
        ctx.close()
    b.close()
print(json.dumps(out, indent=1))
sys.exit(0 if ok else 1)
