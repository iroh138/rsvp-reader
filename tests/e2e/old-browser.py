"""QA-04 / ADR 0005: a browser without the features pdf.js 6 needs gets a clear message instead of a broken import.
Simulated by making CSS.supports report no support for round(). Usage: python3 tests/e2e/old-browser.py http://localhost:8080/"""
import sys, json
from playwright.sync_api import sync_playwright
url = sys.argv[1]
here = __import__('os').path.dirname(__import__('os').path.abspath(__file__))
pdf = here + '/../fixtures/book.pdf'
with sync_playwright() as p:
    b = p.chromium.launch(); out = {}
    for name, script in {'old': "CSS.supports = () => false;", 'current': ''}.items():
        ctx = b.new_context(); ctx.add_init_script(script); pg = ctx.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(url, wait_until='load'); pg.wait_for_timeout(400)
        pg.set_input_files('#fileIn', pdf)
        pg.wait_for_function("() => (document.querySelector('#libMsg').textContent || '').length > 0", timeout=60000)
        out[name] = {'message': pg.inner_text('#libMsg'), 'books': pg.locator('#books .book').count(), 'errors': errors}
        ctx.close()
    b.close()
print(json.dumps(out, indent=1))
ok = out['old']['message'].startswith('This browser is too old') and out['old']['books'] == 0 and out['current']['message'].startswith('Added') and not out['old']['errors']
sys.exit(0 if ok else 1)
