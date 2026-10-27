"""Screen states (UX-02): every main screen shows loading, empty, error and success, and an error never leaves a
loading text stuck on screen. The checklist this proves is docs/ux-states.md.
Errors are produced the way they happen in real life: a book whose stored pages are incomplete, a book whose PDF
file is missing from storage, a file that is not a PDF.
Usage: python3 tests/e2e/states.py http://localhost:8080/"""
import sys, json, os, urllib.request
from playwright.sync_api import sync_playwright

url = sys.argv[1]
fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures')
IDB = """async (fn) => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); });
  const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const t = (s) => db.transaction(s, 'readwrite').objectStore(s);
  const docs = await all('documents'); const res = await (new Function('docs', 't', 'all', 'return (' + fn + ')(docs, t, all)'))(docs, t, all);
  await new Promise(r => setTimeout(r, 100)); db.close(); return res; }"""
# Records every text an element shows, so short-lived loading states are seen too.
WATCH = """(sel) => { window.__seen = window.__seen || {}; const el = document.querySelector(sel); const rec = window.__seen[sel] = [el.textContent];
  new MutationObserver(() => { const t = el.textContent; if (rec[rec.length - 1] !== t) rec.push(t); }).observe(el, { childList: true, characterData: true, subtree: true }); }"""
seen = lambda pg, sel: pg.evaluate("(sel) => window.__seen[sel]", sel)
msg = lambda pg: pg.evaluate("() => [document.querySelector('#libMsg').className, document.querySelector('#libMsg').textContent]")
idle = "() => document.querySelector('#importBox').hidden && document.querySelector('#libMsg').textContent.length > 0"
out, ok = {}, {}

html = urllib.request.urlopen(url).read().decode()
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(bypass_csp=True, viewport={'width': 1280, 'height': 900})   # the test helper above uses new Function; the app itself runs unchanged
    pg = ctx.new_page()
    pg.goto(url, wait_until='load'); pg.evaluate('navigator.serviceWorker.ready'); pg.wait_for_timeout(500)

    # ---- library + reader: loading and empty ----
    out['library_loading_in_html'] = 'Loading your library…' in html
    out['library_empty'] = pg.inner_text('#books')
    out['reader_empty'] = [pg.inner_text('#titleLabel'), pg.inner_text('#meta'), pg.inner_text('#row')]
    ok['library_loading'] = out['library_loading_in_html']
    ok['library_empty'] = out['library_empty'].startswith('No books yet')
    # no book yet: the reader holds the built-in sample, labelled as such (not as "Pasted text")
    ok['reader_empty'] = out['reader_empty'][0] == 'Sample text' and 'word 1 /' in out['reader_empty'][1]

    # ---- import: loading, error, success ----
    pg.evaluate(WATCH, '#importMeta')
    pg.set_input_files('#fileIn', os.path.join(fx, 'notpdf.pdf')); pg.wait_for_function(idle)
    out['import_error'] = msg(pg)
    pg.set_input_files('#fileIn', os.path.join(fx, 'images.pdf')); pg.wait_for_function("() => document.querySelector('#libMsg').textContent.startsWith('Added')", timeout=60000)
    out['import_success'] = msg(pg)
    out['import_loading_texts'] = seen(pg, '#importMeta')
    pg.set_input_files('#fileIn', os.path.join(fx, 'book.pdf')); pg.wait_for_function("() => document.querySelector('#libMsg').textContent.startsWith('Added “Fixture Book')", timeout=60000)
    ok['import_error'] = out['import_error'][0] == 'msg err' and ('not a PDF' in out['import_error'][1] or 'not a valid PDF' in out['import_error'][1])
    ok['import_success'] = out['import_success'][0] == 'msg ok'
    ok['import_loading'] = any(t.startswith('Page ') for t in out['import_loading_texts']) and 'Saving…' in out['import_loading_texts']

    # ---- reader: loading (opening another book) and success ----
    pg.evaluate(WATCH, '#meta')
    pg.locator('#books .book', has_text='Fixture Images').locator('.acts button').first.click(); pg.wait_for_timeout(800)
    out['reader_loading_texts'] = seen(pg, '#meta')
    ok['reader_loading'] = any(t.startswith('Opening “Fixture Images”') for t in out['reader_loading_texts'])
    ok['reader_success'] = '%' in pg.inner_text('#meta')

    # ---- reader: error (stored pages incomplete), and the loading text must not stay ----
    pg.evaluate(IDB, "(docs, t) => { const d = docs.find(d => d.title === 'Fixture Book'); t('pages').delete([d.id, 1]); }")
    pg.locator('#books .book', has_text='Fixture Book').locator('.acts button').first.click(); pg.wait_for_timeout(800)
    out['reader_error'] = msg(pg); out['reader_after_error'] = pg.inner_text('#meta')
    ok['reader_error'] = out['reader_error'][0] == 'msg err' and 'incomplete' in out['reader_error'][1]
    ok['no_stuck_loading'] = not out['reader_after_error'].startswith('Opening')

    # ---- document view: loading placeholder, success ----
    pg.click('#docBtn'); pg.wait_for_timeout(100)
    out['doc_placeholders'] = pg.evaluate("() => [...document.querySelectorAll('.pg .ph')].slice(0, 2).map(e => e.textContent)")
    pg.wait_for_selector('.pg.ready', timeout=30000)
    ok['doc_loading'] = out['doc_placeholders'][:1] == ['Page 1']
    ok['doc_success'] = pg.locator('.pg.ready canvas').count() > 0

    # ---- image during reading: loading, success ----
    for _ in range(12): pg.click('#faster')
    pg.click('#playBtn'); pg.wait_for_selector('#imgView:not([hidden])', timeout=60000)
    out['image_caption'] = pg.inner_text('#imgCap')
    pg.wait_for_function("() => document.querySelector('#imgCanvas').dataset.ready === '1'", timeout=30000)
    ok['image_loading_and_success'] = out['image_caption'].startswith('Image · page')
    pg.click('#imgContBtn'); pg.keyboard.press('Space')

    # ---- document view and image: error (the PDF file is missing from storage) ----
    pg.evaluate(IDB, "(docs, t) => { const d = docs.find(d => d.title === 'Fixture Images'); t('files').delete(d.id); t('progress').put({ docId: d.id, tokenIndex: 0, updatedAt: Date.now() }); }")
    pg.reload(wait_until='load'); pg.wait_for_timeout(1000)
    pg.click('#docBtn'); pg.wait_for_timeout(1500)
    out['doc_error'] = pg.inner_text('#pickLabel')
    out['doc_error_pages'] = pg.evaluate("() => [...new Set([...document.querySelectorAll('.pg .ph')].map(e => e.textContent).filter(t => t.startsWith('Could')))]")
    ok['doc_error'] = 'Could not show the PDF pages' in out['doc_error'] and 'missing' in out['doc_error']
    ok['doc_page_error_placeholder'] = any(t.startswith('Could not show page') for t in out['doc_error_pages'])
    pg.click('#playBtn'); pg.wait_for_selector('#imgView:not([hidden])', timeout=60000); pg.wait_for_timeout(1500)
    out['image_error'] = pg.inner_text('#imgCap')
    ok['image_error'] = out['image_error'].startswith('Could not show the image')
    b.close()

print(json.dumps(out, indent=1, ensure_ascii=False)); print(json.dumps(ok))
sys.exit(0 if all(ok.values()) else 1)
