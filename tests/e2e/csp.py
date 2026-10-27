"""Content-Security-Policy check (SEC-04): the app works under the production headers (hosting/_headers) with zero
policy violations. Serve dist/ with scripts/serve.mjs, which applies the same headers.
Covers: page load, service worker, fonts, sample text, PDF import incl. the JPEG 2000 wasm decoder, page view with
text layer and image, and every in-app check. Also checks that the policy is enforced (an injected inline script is blocked).
Usage: python3 tests/e2e/csp.py http://localhost:8080/"""
import sys, json, os, glob
from playwright.sync_api import sync_playwright

url = sys.argv[1]
fixtures = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures')
WATCH = """window.__csp = []; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective + ' ' + (e.blockedURI || '') + ' ' + (e.sourceFile || '')));"""
out = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context()
    ctx.add_init_script(WATCH)
    pg = ctx.new_page()
    console = []
    pg.on('console', lambda m: m.type in ('error', 'warning') and console.append(m.text))
    pg.on('pageerror', lambda e: console.append('pageerror: ' + str(e)))
    resp = pg.goto(url + '?dev', wait_until='load')
    h = resp.headers
    out['headers'] = {k: h.get(k) for k in ('content-security-policy', 'x-frame-options', 'referrer-policy', 'cross-origin-opener-policy', 'permissions-policy')}
    pg.evaluate('navigator.serviceWorker.ready')
    # The policy is really enforced: an injected inline script must not run and must be reported.
    # (eval() cannot be probed from here: DevTools-protocol evaluation is exempt from CSP.)
    out['inline_script_blocked'] = pg.evaluate("() => new Promise(r => { const s = document.createElement('script'); s.textContent = 'window.__ran = 1'; document.head.append(s); setTimeout(() => r(!window.__ran && window.__csp.some(v => v.startsWith('script-src'))), 300); })")
    pg.evaluate("() => { window.__csp.length = 0 }")
    pg.wait_for_timeout(200); del console[:]   # forget the intentional violation
    for f in ('book.pdf', 'jpx.pdf', 'cyrillic.pdf'):
        pg.set_input_files('#fileIn', os.path.join(fixtures, f))
        pg.wait_for_function("() => (document.querySelector('#libMsg').textContent||'').startsWith('Added')", timeout=60000)
        pg.evaluate("document.querySelector('#libMsg').textContent = ''")
    pg.click('#checkBtn')
    pg.wait_for_function("() => document.querySelectorAll('#results .res').length > 0 && !document.querySelector('#checkBtn').disabled", timeout=180000)
    pg.wait_for_timeout(3000)
    res = [(r.get_attribute('class').split()[-1], r.locator('.txt').inner_text().split('\n')[0]) for r in pg.locator('#results .res').all()]
    out['checks'] = len(res)
    out['failed_checks'] = [t for k, t in res if k == 'bad']
    out['violations'] = pg.evaluate('window.__csp')
    # the service worker runs under its own response's CSP; a reload served from its cache must also be clean
    pg.reload(wait_until='load'); pg.wait_for_timeout(1500)
    out['violations_after_reload'] = pg.evaluate('window.__csp')
    out['csp_console'] = [c for c in console if 'Content Security Policy' in c or 'Refused' in c]
    b.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
csp = out['headers']['content-security-policy'] or ''
ok = ("frame-ancestors 'none'" in csp and 'unsafe-inline' not in csp and "'unsafe-eval'" not in csp and out['inline_script_blocked']
      and out['checks'] > 0 and not out['failed_checks'] and not out['violations'] and not out['violations_after_reload'] and not out['csp_console'])
sys.exit(0 if ok else 1)
