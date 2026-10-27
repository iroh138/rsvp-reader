"""Checks: dev panels hidden in production, service worker installs, app loads offline after first visit,
and (with a PDF argument) a PDF can be imported offline.
Usage: python3 tests/e2e/offline.py http://localhost:8080/ [tests/fixtures/book.pdf]"""
import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context()
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.goto(url, wait_until="load")
    pg.wait_for_function("() => navigator.serviceWorker && navigator.serviceWorker.controller !== undefined", timeout=10000)
    pg.evaluate("navigator.serviceWorker.ready")
    pg.wait_for_timeout(2000)
    out = {
        "devPanelsVisible": pg.is_visible("#checkBtn") or pg.is_visible("#src"),
        "milestoneTag": pg.locator(".tag").count(),
        "swScope": pg.evaluate("navigator.serviceWorker.ready.then(r => r.active && r.active.scriptURL)"),
        "cacheKeys": pg.evaluate("caches.keys()"),
    }
    pg.reload(wait_until="load"); pg.wait_for_timeout(500)
    ctx.set_offline(True)
    pg.reload(wait_until="load"); pg.wait_for_timeout(1500)
    out["offlineTitle"] = pg.title()
    out["offlineReaderVisible"] = pg.is_visible("#reader")
    out["offlineMeta"] = pg.inner_text("#meta")
    out["pdfjsOffline"] = pg.evaluate("Promise.all(['vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdfjs/wasm/openjpeg.wasm'].map(u => fetch(u).then(r => r.status))).catch(e => 'fail: ' + e)")
    # the whole PDF import must work without a network (module worker and wasm come from the cache)
    pdf = sys.argv[2] if len(sys.argv) > 2 else None
    if pdf:
        pg.set_input_files('#fileIn', pdf)
        pg.wait_for_function("() => (document.querySelector('#libMsg').textContent || '').length > 0", timeout=60000)
        out["offlineImport"] = pg.inner_text('#libMsg')
    out["errors"] = errs
    print(json.dumps(out, indent=1, ensure_ascii=False))
    b.close()
