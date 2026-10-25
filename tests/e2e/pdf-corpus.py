"""PDF corpus check (T1.1-T1.7, SEC-03), and the safety net for pdf.js upgrades.
Imports every PDF in tests/fixtures/ through the real UI in a fresh browser profile, then records what was stored
(straight from IndexedDB) and what the in-app checks say. Compares with a golden file recorded from a known-good build.

  python3 tests/e2e/pdf-corpus.py http://localhost:8080/                 # compare with the golden file
  python3 tests/e2e/pdf-corpus.py http://localhost:8080/ --write         # (re)record the golden file

Exit code 1 when anything differs; the differences are printed so a human can judge them."""
import sys, json, os, re, glob
from playwright.sync_api import sync_playwright

url = sys.argv[1]
write = '--write' in sys.argv
here = os.path.dirname(os.path.abspath(__file__))
fixtures = os.path.join(here, '..', 'fixtures')
golden_path = os.path.join(fixtures, 'golden.json')

DUMP = r"""
async () => {
  const open = () => new Promise((res, rej) => { const r = indexedDB.open('rsvp-reader'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const all = (db, s) => new Promise((res, rej) => { const r = db.transaction(s).objectStore(s).getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const sha = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const db = await open();
  const docs = await all(db, 'documents'), pages = await all(db, 'pages'), files = await all(db, 'files');
  const out = { documents: docs.length, files: files.length, pages: pages.length, books: [] };
  for (const d of docs) {
    const ps = pages.filter(p => p.docId === d.id).sort((a, b) => a.pageIndex - b.pageIndex);
    const flags = f => ps.reduce((n, p) => n + p.tokFlags.filter(x => x & f).length, 0);
    out.books.push({
      title: d.title, pageCount: d.pageCount, totalTokens: d.totalTokens, emptyPages: d.emptyPages, failedPages: d.failedPages,
      garbled: d.garbled, cleanup: d.cleanup, images: d.images,
      skipped: flags(1), clause: flags(2), sentence: flags(4), paragraph: flags(8),
      pageText: await Promise.all(ps.map(p => sha(p.text))),
      firstWords: ps.length ? ps[0].text.trim().split(/\s+/).slice(0, 8).join(' ') : '',
    });
  }
  db.close();
  return out;
}
"""

def run_one(browser, path):
    ctx = browser.new_context(); pg = ctx.new_page(); errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)[:200]))
    pg.goto(url + '?dev', wait_until='load'); pg.wait_for_timeout(500)
    pg.set_input_files('#fileIn', path)
    pg.wait_for_function("(document.querySelector('#libMsg').textContent || '').length > 0", timeout=120000)
    msg = re.sub(r'\d+(\.\d+)? s\.', 'N s.', pg.inner_text('#libMsg'))
    pg.wait_for_timeout(1500)
    rec = {'message': msg, 'stored': pg.evaluate(DUMP)}
    if msg.startswith('Added'):
        pg.locator('#results').evaluate("e => e.innerHTML = ''")
        pg.click('#checkBtn')
        pg.wait_for_function("document.querySelectorAll('#results .res').length > 0 && !document.querySelector('#checkBtn').disabled", timeout=120000)
        pg.wait_for_timeout(4000)
        checks = [(r.get_attribute('class').split()[-1], r.locator('.txt').inner_text().split('\n')[0]) for r in pg.locator('#results .res').all()]
        rec['checks'] = [f'{k}: {t}' for k, t in checks if re.search(r'Every character|Tapping a word|Images|first image', t)]
        rec['checks_failed'] = [t for k, t in checks if k == 'bad']
    rec['page_errors'] = errors
    ctx.close()
    return rec

def diff(a, b, path=''):
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)): out += diff(a.get(k), b.get(k), f'{path}.{k}')
    elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
        for i, (x, y) in enumerate(zip(a, b)): out += diff(x, y, f'{path}[{i}]')
    elif a != b:
        out.append(f'{path}: golden={json.dumps(a, ensure_ascii=False)[:160]} now={json.dumps(b, ensure_ascii=False)[:160]}')
    return out

results = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    for f in sorted(glob.glob(os.path.join(fixtures, '*.pdf'))):
        results[os.path.basename(f)] = run_one(b, f)
    b.close()

if write:
    json.dump(results, open(golden_path, 'w'), indent=1, ensure_ascii=False, sort_keys=True)
    print(f'wrote {golden_path}')
    for name, r in results.items(): print(f"{name:16} {r['message'][:90]}")
    sys.exit(0)

golden = json.load(open(golden_path))
problems = diff(golden, json.loads(json.dumps(results)))
for name, r in results.items():
    print(f"{name:16} {r['message'][:90]}")
    problems += [f'{name}: in-app check failed: {t}' for t in r.get('checks_failed', [])]
    problems += [f'{name}: page error: {e}' for e in r['page_errors']]
print('\n'.join(problems) if problems else 'All PDFs match the golden file.')
sys.exit(1 if problems else 0)
