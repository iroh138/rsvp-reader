"""Performance budgets for large books (PLAN.md §3). Runs with the CPU slowed down 4x as a stand-in for a mid-range
phone; this is a proxy, not a device measurement (that one is in docs/platforms.md).
Books: tests/fixtures/perf/long-300.pdf and long-1000.pdf (scripts/make-fixtures.py).
Budgets: import 300 pages <= 30 s; import 1000 pages completes (<= 120 s, main-thread heap peak <= 150 MB);
start from cache, offline, with the 1000-page book open <= 2 s; first document page <= 2 s;
reading 20 s: no frame over 250 ms; the reading position is saved at least every 5 s while reading.
Usage: python3 tests/e2e/perf.py http://localhost:8080/"""
import sys, json, os, time, tempfile
from playwright.sync_api import sync_playwright

url = sys.argv[1]
perf = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures', 'perf')
RATE = 4
out, ok = {}, {}
idle = "() => document.querySelector('#importBox').hidden && document.querySelector('#libMsg').textContent.length > 0"
with sync_playwright() as p:
    prof = tempfile.mkdtemp()
    args = ['--enable-precise-memory-info']
    ctx = p.chromium.launch_persistent_context(prof, args=args); pg = ctx.pages[0]
    pg.goto(url, wait_until='load'); pg.evaluate('navigator.serviceWorker.ready')
    ctx.new_cdp_session(pg).send('Emulation.setCPUThrottlingRate', {'rate': RATE})
    for n in (300, 1000):
        pg.evaluate("() => { window.__peak = 0; window.__iv = setInterval(() => { window.__peak = Math.max(window.__peak, performance.memory.usedJSHeapSize); }, 100); }")
        t0 = time.time(); pg.set_input_files('#fileIn', os.path.join(perf, f'long-{n}.pdf'))
        pg.wait_for_function(idle, timeout=600000)
        out[f'import_{n}'] = {'s': round(time.time() - t0, 1), 'message': pg.evaluate("() => document.querySelector('#libMsg').textContent")[:80],
                              'heap_peak_MB': round(pg.evaluate("() => { clearInterval(window.__iv); return window.__peak; }") / 2**20)}
    pg.wait_for_function("() => document.querySelector('#titleLabel').textContent === 'Long Book 1000' && /%/.test(document.querySelector('#meta').textContent)", timeout=60000)
    ok['import_300'] = out['import_300']['message'].startswith('Added') and out['import_300']['s'] <= 30
    ok['import_1000'] = out['import_1000']['message'].startswith('Added') and out['import_1000']['s'] <= 120 and out['import_1000']['heap_peak_MB'] <= 150
    ctx.close()

    ctx = p.chromium.launch_persistent_context(prof, args=args); pg = ctx.pages[0]
    ctx.new_cdp_session(pg).send('Emulation.setCPUThrottlingRate', {'rate': RATE})
    ctx.set_offline(True)
    t0 = time.time(); pg.goto(url, wait_until='load')
    pg.wait_for_function("() => /%/.test(document.querySelector('#meta').textContent)", timeout=60000)
    out['start_offline_s'] = round(time.time() - t0, 2)
    out['open_book'] = pg.inner_text('#titleLabel')
    ok['start_offline'] = out['start_offline_s'] <= 2 and out['open_book'] == 'Long Book 1000'
    pg.wait_for_timeout(2000)

    SAVES = """async () => { const db = await new Promise(r => { const q = indexedDB.open('rsvp-reader'); q.onsuccess = () => r(q.result); });
      const all = await new Promise(r => { const q = db.transaction('progress').objectStore('progress').getAll(); q.onsuccess = () => r(q.result); }); db.close();
      return Math.max(...all.map(x => x.updatedAt)); }"""
    pg.evaluate("() => { window.__f = []; let l = performance.now(); window.__s = l; const tick = t => { window.__f.push(t - l); l = t; if (t - window.__s < 21000) requestAnimationFrame(tick); }; requestAnimationFrame(tick); }")
    pg.keyboard.press('Space')
    saves = []
    for _ in range(20):
        pg.wait_for_timeout(1000); saves.append(pg.evaluate(SAVES))
    pg.keyboard.press('Space')
    fr = pg.evaluate('window.__f')
    changes = sorted(x for x in set(saves) if x and x > 0 and x != float('inf')); gaps = [b - a for a, b in zip(changes, changes[1:])]
    out['reading'] = {'frames': len(fr), 'max_frame_ms': round(max(fr)), 'save_gaps_ms': gaps}
    ok['reading_smooth'] = max(fr) <= 250
    ok['position_saved_every_5s'] = len(changes) >= 3 and max(gaps) <= 6000   # 5 s + timer and poll slack

    t0 = time.time(); pg.click('#docBtn'); pg.wait_for_selector('.pg.ready', timeout=60000)
    out['doc_first_page_s'] = round(time.time() - t0, 2)
    ok['doc_first_page'] = out['doc_first_page_s'] <= 2
    ctx.close()
print(json.dumps(out, indent=1, ensure_ascii=False)); print(json.dumps(ok))
sys.exit(0 if all(ok.values()) else 1)
