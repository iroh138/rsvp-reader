"""Local data integrity (ARH-01): imports are all-or-nothing, interruptions leave nothing half-written, running out
of space is handled, and another tab never deletes an import that is still running.
After every scenario the library must be CONSISTENT: every book has its file and all of its pages, and no pages are
left without a book (once no import is running).
  1. out of space: an import that does not fit fails with a clear message and leaves nothing; a smaller book still fits;
     restoring a backup that does not fit stops with a message and keeps what was restored before
  2. tab closed during an import, at many different moments (CPU slowed down 20x): consistent after reopening, and
     the same PDF can then be imported normally
  3. a second tab opening while an import runs must not delete that import's pages (the old code did)
Usage: python3 tests/e2e/integrity.py http://localhost:8080/"""
import sys, json, os, tempfile, zipfile, hashlib, time
from playwright.sync_api import sync_playwright

url = sys.argv[1]
origin = url.split('/')[0] + '//' + url.split('/')[2]
fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures')
STATE = """async () => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); });
  const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const keys = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAllKeys(); q.onsuccess = () => r(q.result); });
  const [docs, files, pages] = await Promise.all([all('documents'), keys('files'), keys('pages')]); db.close();
  const per = {}; for (const [id] of pages) per[id] = (per[id] || 0) + 1;
  const ids = new Set(docs.map(d => d.id));
  return { books: docs.length,
    broken: docs.filter(d => !files.includes(d.id) || per[d.id] !== d.pageCount).map(d => d.title),
    orphanPages: Object.keys(per).filter(id => !ids.has(id)).length,
    filesWithoutBook: files.filter(id => !ids.has(id)).length }; }"""
msg = "() => document.querySelector('#libMsg').textContent"
idle = "() => document.querySelector('#importBox').hidden && !document.querySelector('#restoreBtn').disabled && document.querySelector('#libMsg').textContent.length > 0 && !/^Restoring/.test(document.querySelector('#libMsg').textContent)"
consistent = lambda s: not s['broken'] and not s['orphanPages'] and not s['filesWithoutBook']
out, ok = {}, {}

def stored_zip(path, pdfs):
    # a backup in the app's format, written by Python (stored entries, no extra fields)
    books = [{'file': f'books/{i + 1}.pdf', 'id': hashlib.sha256(open(os.path.join(fx, f), 'rb').read()).hexdigest(), 'title': f, 'fileName': f} for i, f in enumerate(pdfs)]
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_STORED) as z:
        z.writestr('library.json', json.dumps({'app': 'rsvp-reader', 'kind': 'library', 'v': 1, 'books': books, 'positions': [], 'settings': {}}))
        for i, f in enumerate(pdfs): z.write(os.path.join(fx, f), f'books/{i + 1}.pdf')

with sync_playwright() as p:
    b = p.chromium.launch()

    # ---- 1. out of space ----
    ctx = b.new_context(); pg = ctx.new_page(); pg.goto(url, wait_until='load'); pg.evaluate('navigator.serviceWorker.ready')
    usage = pg.evaluate('navigator.storage.estimate()')['usage']
    ctx.new_cdp_session(pg).send('Storage.overrideQuotaForOrigin', {'origin': origin, 'quotaSize': usage + 150_000})
    pg.set_input_files('#fileIn', os.path.join(fx, 'images.pdf'))      # 230 KB: does not fit
    pg.wait_for_function(idle, timeout=60000)
    out['quota_message'] = pg.evaluate(msg); out['quota_state'] = pg.evaluate(STATE)
    pg.set_input_files('#fileIn', os.path.join(fx, 'book.pdf'))         # 7 KB: fits
    pg.wait_for_function(idle, timeout=60000)
    out['small_after_quota'] = pg.evaluate(msg)
    bk = os.path.join(tempfile.mkdtemp(), 'b.zip'); stored_zip(bk, ['cyrillic.pdf', 'images.pdf', 'jpx.pdf'])
    pg.set_input_files('#restoreIn', bk)
    pg.wait_for_function(idle, timeout=120000)
    out['restore_quota_message'] = pg.evaluate(msg); out['restore_quota_state'] = pg.evaluate(STATE)
    ok['quota'] = ('Not enough storage space' in out['quota_message'] and out['quota_state']['books'] == 0 and consistent(out['quota_state'])
                   and out['small_after_quota'].startswith('Added')
                   and 'Stopped: Not enough storage space' in out['restore_quota_message'] and out['restore_quota_message'].startswith('Restored 1 of 3')
                   and out['restore_quota_state']['books'] == 2 and consistent(out['restore_quota_state']))
    ctx.close()

    # ---- 2. tab closed during an import ----
    # A 150-page book makes every stage long enough to hit (reading pages, saving in chunks of 40, final commit).
    from reportlab.pdfgen import canvas
    big = os.path.join(tempfile.mkdtemp(), 'big.pdf')
    cv = canvas.Canvas(big)
    for n in range(150):
        for k in range(40): cv.drawString(60, 780 - k * 18, f'Page {n + 1} line {k + 1}: the quiet reader moves through every line of this long test book.')
        cv.showPage()
    cv.save()
    profile = tempfile.mkdtemp()
    def open_tab():
        ctx = p.chromium.launch_persistent_context(profile)
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        pg.goto(url, wait_until='load'); pg.wait_for_timeout(500)
        return ctx, pg
    def clear(pg):
        pg.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); });
          const t = db.transaction(['documents', 'files', 'pages', 'progress'], 'readwrite'); for (const s of ['documents', 'files', 'pages', 'progress']) t.objectStore(s).clear();
          await new Promise(r => t.oncomplete = r); db.close(); }""")
    # dry run: how long does the whole import take here?
    ctx, pg = open_tab()
    t0 = time.time(); pg.set_input_files('#fileIn', big); pg.wait_for_function(idle, timeout=300000); total = time.time() - t0
    out['full_import_s'] = round(total, 2); clear(pg); ctx.close()
    runs = []
    for frac in [0.05, 0.15, 0.3, 0.45, 0.6, 0.7, 0.8, 0.85, 0.9, 0.93, 0.96, 0.98, 1.0]:
        ctx, pg = open_tab()
        clear(pg)
        pg.set_input_files('#fileIn', big)
        pg.wait_for_timeout(int(total * frac * 1000))
        stage = pg.evaluate("() => document.querySelector('#importBox').hidden ? 'done' : document.querySelector('#importMeta').textContent")
        ctx.close()   # like closing the tab (and the browser) mid-import
        ctx, pg = open_tab()
        runs.append({'at': frac, 'stage': stage, 'after_reopen': pg.evaluate(STATE), 'message': pg.evaluate(msg)})
        ctx.close()
    out['interrupted'] = [{**r, 'stage': r['stage'][:40]} for r in runs]
    ctx, pg = open_tab()
    pg.set_input_files('#fileIn', big); pg.wait_for_function(idle, timeout=300000)
    out['import_after_interruptions'] = pg.evaluate(msg)
    ok['interrupted'] = (all(consistent(r['after_reopen']) for r in runs)
                         and len({r['stage'].split(' ')[0] for r in runs}) >= 3   # really closed at different stages
                         and (out['import_after_interruptions'].startswith('Added') or 'already in your library' in out['import_after_interruptions']))
    ctx.close()

    # ---- 3. another tab opens while an import runs ----
    ctx = b.new_context()
    a = ctx.new_page(); a.goto(url, wait_until='load'); a.evaluate('navigator.serviceWorker.ready')
    # tab A: an import of book "X" that has written its pages but not yet its document (holds the import lock)
    a.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); });
      const t = db.transaction('pages', 'readwrite'); for (let i = 0; i < 3; i++) t.objectStore('pages').put({ docId: 'X', pageIndex: i, text: 'w' });
      await new Promise(r => t.oncomplete = r); db.close();
      window.__release = null; navigator.locks.request('rsvp-import:X', () => new Promise(r => { window.__release = r; })); }""")
    a.wait_for_function("() => typeof window.__release === 'function'")
    c = ctx.new_page(); c.goto(url, wait_until='load'); c.wait_for_timeout(1000)
    out['while_running'] = c.evaluate(STATE)
    a.evaluate('window.__release()'); a.wait_for_timeout(200)
    c.reload(wait_until='load'); c.wait_for_timeout(1000)
    out['after_it_ended'] = c.evaluate(STATE)
    ok['other_tab'] = out['while_running']['orphanPages'] == 1 and out['after_it_ended']['orphanPages'] == 0
    ctx.close()
    b.close()

print(json.dumps(out, indent=1, ensure_ascii=False))
print(json.dumps(ok))
sys.exit(0 if all(ok.values()) else 1)
