"""Upgrade check (T4.2, T5.4): a user of the previous build with an imported book gets the new build.
The library and position must survive, the new service worker must take over, and old caches must be removed.
Usage: python3 tests/e2e/upgrade.py <old dist dir> <new dist dir> <book.pdf>
Starts its own server for each dir on the same port, so both builds share one origin."""
import sys, json, subprocess, time, tempfile, os
from playwright.sync_api import sync_playwright

old_dir, new_dir, pdf = sys.argv[1:4]
port = 8799
url = f'http://127.0.0.1:{port}/'
here = os.path.dirname(os.path.abspath(__file__))
serve = os.path.join(here, '..', '..', 'scripts', 'serve.mjs')

def start(d):
    proc = subprocess.Popen(['node', serve, d, str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(0.8)
    return proc

out = {}
profile = tempfile.mkdtemp()
with sync_playwright() as p:
    srv = start(old_dir)
    ctx = p.chromium.launch_persistent_context(profile)
    pg = ctx.new_page()
    pg.goto(url, wait_until='load')
    pg.evaluate('navigator.serviceWorker.ready')
    pg.set_input_files('#fileIn', pdf)
    pg.wait_for_function("(document.querySelector('#libMsg').textContent||'').startsWith('Added')", timeout=60000)
    pg.keyboard.press('Space'); pg.wait_for_timeout(1500); pg.keyboard.press('Space'); pg.wait_for_timeout(300)
    out['old_meta'] = pg.inner_text('#meta')
    out['old_books'] = pg.locator('#books .book .t').all_inner_texts()
    out['old_warnings'] = pg.locator('#books .book .w').all_inner_texts()
    out['old_store'] = pg.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); }); const ps = await new Promise(r => { const q = db.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => r(q.result); }); const ds = await new Promise(r => { const q = db.transaction('documents').objectStore('documents').getAll(); q.onsuccess = () => r(q.result); }); db.close(); return { skipped: ps.reduce((n, p) => n + p.tokFlags.filter(f => f & 1).length, 0), processor: ds.map(d => d.processorVersion) }; }""")
    out['old_caches'] = pg.evaluate('caches.keys()')
    ctx.close(); srv.terminate(); srv.wait()

    srv = start(new_dir)
    ctx = p.chromium.launch_persistent_context(profile)
    pg = ctx.new_page()
    first, external = [], []
    log = first
    pg.on('request', lambda r: (not r.url.startswith(url)) and not r.url.startswith(('data:', 'blob:')) and log.append(r.url))
    # First visit after a deploy: the OLD worker still serves the OLD cached page (standard service worker model);
    # meanwhile the new worker installs, skips waiting and claims the page.
    pg.goto(url, wait_until='load')
    pg.wait_for_timeout(2500)
    log = external
    pg.reload(wait_until='load'); pg.wait_for_timeout(1500)
    out['first_visit_external_requests'] = first
    out['new_caches'] = pg.evaluate('caches.keys()')
    out['new_sw_version'] = pg.evaluate("fetch('build.json').then(r => r.json()).then(j => j.version)")
    out['books'] = pg.locator('#books .book .t').all_inner_texts()
    out['new_meta'] = pg.inner_text('#meta')
    out['external_requests'] = external
    out['warnings'] = pg.locator('#books .book .w').all_inner_texts()
    out['store'] = pg.evaluate("""async () => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); }); const ps = await new Promise(r => { const q = db.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => r(q.result); }); const ds = await new Promise(r => { const q = db.transaction('documents').objectStore('documents').getAll(); q.onsuccess = () => r(q.result); }); db.close(); return { skipped: ps.reduce((n, p) => n + p.tokFlags.filter(f => f & 1).length, 0), processor: ds.map(d => d.processorVersion) }; }""")
    # The book was imported by the OLD build; the new build must still map taps to the stored words, etc.
    pg.goto(url + '?dev', wait_until='load'); pg.wait_for_timeout(2500)
    pg.click('#checkBtn')
    pg.wait_for_function("document.querySelectorAll('#results .res').length > 0 && !document.querySelector('#checkBtn').disabled", timeout=120000)
    pg.wait_for_timeout(5000)
    res = [(r.get_attribute('class').split()[-1], r.locator('.txt').inner_text().split('\n')[0]) for r in pg.locator('#results .res').all()]
    out['checks_after_upgrade'] = [f'{k}: {t[:90]}' for k, t in res if k != 'ok' or 'Tapping' in t or 'Every character' in t]
    out['failed_after_upgrade'] = [t for k, t in res if k == 'bad']
    ctx.close(); srv.terminate(); srv.wait()

print(json.dumps(out, indent=1, ensure_ascii=False))
ok = (out['books'] == out['old_books'] and len(out['books']) == 1 and out['new_caches'] == ['rsvp-app-' + out['new_sw_version']]
      and out['new_meta'] == out['old_meta'] and not out['external_requests'] and not out['failed_after_upgrade']
      and any(c.startswith('ok: Tapping') for c in out['checks_after_upgrade']))
sys.exit(0 if ok else 1)
