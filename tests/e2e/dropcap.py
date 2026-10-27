"""Drop caps and ellipses in a real PDF (N4, docs/pdf-corpus.md): tests/fixtures/dropcap.pdf, where the large "A" is written before
the chapter title. The reader must show the title, the subtitle, then "An important ..." (not "A", title, "n");
tapping the big letter on the page must choose "An"; "odjednom...polete" must be two words.
Usage: python3 tests/e2e/dropcap.py http://localhost:8080/"""
import sys, json, os
from playwright.sync_api import sync_playwright

url = sys.argv[1]
pdf = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures', 'dropcap.pdf')
WORDS = """() => { const r = document.querySelector('#row'); window.__w = [];
  new MutationObserver(() => { const t = r.textContent; if (t && window.__w[window.__w.length - 1] !== t) window.__w.push(t); }).observe(r, { childList: true, subtree: true, characterData: true }); }"""
out, ok = {}, {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.goto(url, wait_until='load'); pg.evaluate('navigator.serviceWorker.ready')
    pg.set_input_files('#fileIn', pdf)
    pg.wait_for_function("() => document.querySelector('#libMsg').textContent.startsWith('Added')", timeout=60000)
    for _ in range(28): pg.click('#faster')       # 1000 wpm
    pg.evaluate(WORDS); pg.keyboard.press('Space'); pg.wait_for_timeout(15000); pg.keyboard.press('Space')
    w = pg.evaluate('window.__w'); out['words'] = ' '.join(w)
    ok['title_first'] = w[:2] == ['ALL', 'BEHAVIOR']
    ok['cap_joined'] = 'An' in w and 'A' not in w and 'n' not in w and w[w.index('An') + 1] == 'important'
    ok['ellipsis_split'] = 'odjednom...' in w and 'polete' in w
    # tap the big letter in the document view
    pg.click('#docBtn'); pg.wait_for_selector('.pg.ready .textLayer span', timeout=30000)
    pg.locator('.pg.ready .textLayer span', has_text='A').filter(has_text=__import__('re').compile(r'^A$')).first.click()
    pg.wait_for_timeout(300)
    out['tap_on_cap'] = pg.inner_text('#pickLabel')
    ok['tap_on_cap'] = out['tap_on_cap'].startswith('“An”')
    b.close()
print(json.dumps(out, indent=1, ensure_ascii=False)); print(json.dumps(ok))
sys.exit(0 if all(ok.values()) else 1)
