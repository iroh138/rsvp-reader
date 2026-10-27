"""Accessibility scan (QA-03): axe-core (pinned in tests/a11y/package-lock.json; run `npm ci` there first) against
every main screen state, under the production headers, with WCAG 2.0/2.1/2.2 A and AA rules.
States: empty library, error message, book open, document view, positions box, image shown during reading, focus mode,
and book open at phone width.
Usage: python3 tests/e2e/a11y.py http://localhost:8080/ [--verbose]"""
import sys, json, os
from playwright.sync_api import sync_playwright

url = sys.argv[1]; verbose = '--verbose' in sys.argv
here = os.path.dirname(os.path.abspath(__file__))
fx = os.path.join(here, '..', 'fixtures')
AXE = open(os.path.join(here, '..', 'a11y', 'node_modules', 'axe-core', 'axe.min.js')).read()
TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']
results = {}

def scan(pg, state):
    if not pg.evaluate('() => !!window.axe'): pg.evaluate(AXE)   # DevTools-protocol evaluation is exempt from the CSP
    r = pg.evaluate("async (tags) => { const r = await axe.run(document, { runOnly: { type: 'tag', values: tags } }); return r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map(n => ({ target: n.target.join(' '), why: n.failureSummary })) })); }", TAGS)
    results[state] = r

def added(pg):
    pg.wait_for_function("() => /^(Added|“)/.test(document.querySelector('#libMsg').textContent) && document.querySelector('#importBox').hidden", timeout=60000)

with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.goto(url, wait_until='load'); pg.evaluate('navigator.serviceWorker.ready'); pg.wait_for_timeout(500)
    scan(pg, 'empty library')
    pg.set_input_files('#fileIn', os.path.join(fx, 'notpdf.pdf')); pg.wait_for_timeout(800)
    scan(pg, 'error message')
    pg.set_input_files('#fileIn', os.path.join(fx, 'book.pdf')); added(pg)
    pg.set_input_files('#fileIn', os.path.join(fx, 'images.pdf')); added(pg)
    scan(pg, 'book open')
    pg.click('#docBtn'); pg.wait_for_timeout(1500)
    scan(pg, 'document view')
    pg.click('#docBtn'); pg.wait_for_timeout(300)
    pg.click('#pastePosBtn'); pg.wait_for_timeout(200)
    scan(pg, 'positions box')
    pg.click('#posClose')
    for _ in range(12): pg.click('#faster')
    pg.click('#playBtn')
    try:
        pg.wait_for_selector('#imgView:not([hidden])', timeout=60000); pg.wait_for_timeout(500)
        scan(pg, 'image shown')
        pg.click('#imgContBtn')
    except Exception as e:
        results['image shown'] = [{'id': 'state-not-reached', 'impact': 'n/a', 'help': str(e)[:80], 'nodes': []}]
    pg.keyboard.press('Space'); pg.wait_for_timeout(200)
    pg.click('#focusBtn'); pg.wait_for_timeout(500)
    scan(pg, 'focus mode')
    b2 = p.chromium.launch(); ph = b2.new_page(viewport={'width': 360, 'height': 740}, is_mobile=True, has_touch=True)
    ph.goto(url, wait_until='load'); ph.wait_for_timeout(500)
    ph.set_input_files('#fileIn', os.path.join(fx, 'book.pdf')); added(ph)
    scan(ph, 'book open, phone width')
    b2.close()
    b.close()

summary = {s: sorted({f"{v['impact']}: {v['id']} ({len(v['nodes'])})" for v in vs}) for s, vs in results.items()}
print(json.dumps(results if verbose else summary, indent=1, ensure_ascii=False))
sys.exit(0 if not any(results.values()) else 1)
