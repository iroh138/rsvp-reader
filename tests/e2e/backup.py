"""Library backup and restore (DEX-01): back up on one device, restore on another.
Device A imports three PDFs, reads a little and changes a setting, then makes a backup through the real UI.
Device B (a fresh browser profile) restores it. Checks: the ZIP opens in a standard tool and holds the exact PDFs;
B ends up with the same books, the same stored text per page, the same reading position and setting; restoring twice
adds nothing; damaged files are refused without changing the library; no CSP violations (production headers).
Usage: python3 tests/e2e/backup.py http://localhost:8080/"""
import sys, json, os, re, zipfile, hashlib, tempfile
from playwright.sync_api import sync_playwright

url = sys.argv[1]
fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures')
PDFS = ['book.pdf', 'cyrillic.pdf', 'images.pdf']
tmp = tempfile.mkdtemp()
WATCH = "window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + e.blockedURI));"
STORE = """async () => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); });
  const all = s => new Promise(r => { const q = db.transaction(s).objectStore(s).getAll(); q.onsuccess = () => r(q.result); });
  const [docs, pages, prog] = await Promise.all([all('documents'), all('pages'), all('progress')]); db.close();
  const h = async t => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))), b => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
  const text = {}; for (const p of pages) text[p.docId + '#' + p.pageIndex] = await h(p.text + '|' + Array.from(p.tokFlags).join(','));
  return { docs: docs.map(d => [d.id, d.title, d.totalTokens]).sort(), pages: text, progress: prog.map(p => [p.docId, p.tokenIndex]).sort() }; }"""
msg = "() => document.querySelector('#libMsg').textContent"
out = {}

def device(p):
    ctx = p.chromium.launch_persistent_context(tempfile.mkdtemp(), accept_downloads=True)
    ctx.add_init_script(WATCH)
    pg = ctx.new_page()
    errs = []
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto(url, wait_until='load'); pg.evaluate('navigator.serviceWorker.ready')
    return ctx, pg, errs

def restore(pg, path):
    pg.set_input_files('#restoreIn', path)
    pg.wait_for_function("() => !document.querySelector('#restoreBtn').disabled && !/^Restoring|^$/.test(document.querySelector('#libMsg').textContent)", timeout=180000)
    return pg.evaluate(msg)

with sync_playwright() as p:
    # ---- device A ----
    ctx, pg, errs_a = device(p)
    for f in PDFS:
        pg.set_input_files('#fileIn', os.path.join(fx, f))
        pg.wait_for_function("() => (document.querySelector('#libMsg').textContent||'').startsWith('Added')", timeout=60000)
    pg.keyboard.press('Space'); pg.wait_for_timeout(1500); pg.keyboard.press('Space'); pg.wait_for_timeout(300)
    pg.evaluate("() => { const s = JSON.parse(localStorage.getItem('rsvp-settings') || '{}'); s.wpm = 420; localStorage.setItem('rsvp-settings', JSON.stringify(s)); }")
    pg.reload(wait_until='load'); pg.wait_for_timeout(1000)
    a_meta = pg.inner_text('#meta'); a_store = pg.evaluate(STORE); a_current = pg.inner_text('#books .book.current .t')
    with pg.expect_download() as dl:
        pg.click('#backupBtn')
    path = os.path.join(tmp, dl.value.suggested_filename); dl.value.save_as(path)
    pg.wait_for_function("() => document.querySelector('#libMsg').textContent.startsWith('Saved')")
    out['backup_message'] = pg.evaluate(msg)
    out['a_csp'] = pg.evaluate('window.__csp')
    ctx.close()

    z = zipfile.ZipFile(path)
    out['zip_test'] = z.testzip()
    names = z.namelist()
    sha = lambda b: hashlib.sha256(b).hexdigest()
    in_zip = sorted(sha(z.read(n)) for n in names if n.startswith('books/'))
    out['zip_has_exact_pdfs'] = in_zip == sorted(sha(open(os.path.join(fx, f), 'rb').read()) for f in PDFS)
    out['zip_names'] = names

    # ---- device B ----
    ctx, pg, errs_b = device(p)
    bad = os.path.join(tmp, 'truncated.zip'); open(bad, 'wb').write(open(path, 'rb').read()[:-100])
    out['truncated'] = restore(pg, bad)
    out['pdf_renamed'] = restore(pg, os.path.join(fx, 'book.pdf'))
    out['library_after_bad_files'] = pg.locator('#books .book').count()
    out['restore'] = restore(pg, path)
    b_store = pg.evaluate(STORE)
    out['restore_again'] = restore(pg, path)
    out['b_count_after_second_restore'] = len(pg.evaluate(STORE)['docs'])
    pg.reload(wait_until='load'); pg.wait_for_timeout(1000)
    out['wpm_b'] = pg.evaluate("() => JSON.parse(localStorage.getItem('rsvp-settings')).wpm")
    # open the same book A had open, compare the position line
    title = a_current
    out['opened'] = title
    pg.locator('#books .book').filter(has=pg.locator('.t', has_text=re.compile('^' + re.escape(title) + '$'))).locator('.acts button').first.click(); pg.wait_for_timeout(1000)
    out['meta_a'], out['meta_b'] = a_meta, pg.inner_text('#meta')
    out['b_csp'] = pg.evaluate('window.__csp')
    out['console_errors'] = errs_a + errs_b
    ctx.close()

out['same_books'] = a_store['docs'] == b_store['docs']
out['same_text'] = a_store['pages'] == b_store['pages']
out['same_progress'] = a_store['progress'] == b_store['progress']
print(json.dumps({k: v for k, v in out.items()}, indent=1, ensure_ascii=False))
checks = {'zip': out['zip_test'] is None and out['zip_has_exact_pdfs'], 'same': out['same_books'] and out['same_text'] and out['same_progress'],
  'read_something': any(pr[1] > 0 for pr in a_store['progress']), 'restore': out['restore'].startswith('Restored 3 of 3'),
  'again': out['restore_again'].startswith('Restored 0 of 3 books, 3 already'), 'bad_files': 'not a library backup' in out['truncated'] and 'not a library backup' in out['pdf_renamed'] and out['library_after_bad_files'] == 0,
  'settings': out['wpm_b'] == 420, 'position_shown': out['meta_a'] == out['meta_b'], 'clean': not out['a_csp'] and not out['b_csp'] and not out['console_errors']}
print(json.dumps(checks))
sys.exit(0 if all(checks.values()) else 1)
