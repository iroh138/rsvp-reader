"""SEC-03 / T3.8 browser check: hostile "reading positions" text must not break the reader.
Pastes an export with invalid settings, presses Play for 1.5 s and reports how far the reader moved.
At a valid speed (100-1000 wpm) 1.5 s is at most ~25 words; a broken speed races through the whole text.
Usage: python3 tests/e2e/positions.py http://localhost:8080/"""
import sys, json
from playwright.sync_api import sync_playwright

url = sys.argv[1]
CASES = {
    'negative wpm': {'wpm': -100},
    'string wpm': {'wpm': 'fast'},
    'huge sent': {'sent': 1e9},
}
results = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    # Storage already damaged by an older version: the app must start, repair it and read normally.
    for name, stored in {'stored string wpm': '{"wpm":"fast","sent":1e9}', 'stored non-object': '5'}.items():
        ctx = b.new_context(); pg = ctx.new_page(); errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(url, wait_until='load')
        pg.evaluate(f"localStorage.setItem('rsvp-settings', {json.dumps(stored)})")
        pg.goto(url + '?dev', wait_until='load'); pg.wait_for_timeout(800)
        pg.click('#loadBtn'); pg.wait_for_timeout(300)
        pg.click('#playBtn'); pg.wait_for_timeout(1500); pg.keyboard.press('Space'); pg.wait_for_timeout(200)
        results[name] = {'meta_after_1_5s': pg.inner_text('#meta'), 'wpm_label': pg.inner_text('#wpmOut'),
                         'stored_after': pg.evaluate("localStorage.getItem('rsvp-settings')")[:80], 'errors': errors}
        ctx.close()
    for name, bad in CASES.items():
        ctx = b.new_context()
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        pg.goto(url + '?dev', wait_until='load')
        pg.click('#loadBtn'); pg.wait_for_timeout(300)                       # sample text, 191 words
        pg.click('#pastePosBtn')
        pg.fill('#posText', json.dumps({'app': 'rsvp-reader', 'v': 1, 'positions': [], 'settings': bad}))
        pg.click('#posApply'); pg.wait_for_timeout(300)
        msg = pg.inner_text('#posMsg')
        pg.click('#playBtn'); pg.wait_for_timeout(1500); pg.keyboard.press('Space'); pg.wait_for_timeout(200)
        meta = pg.inner_text('#meta')
        stored = pg.evaluate("localStorage.getItem('rsvp-settings')")
        pg.reload(wait_until='load'); pg.wait_for_timeout(800)
        results[name] = {'message': msg, 'meta_after_1_5s': meta, 'wpm_label': pg.inner_text('#wpmOut'),
                         'stored': json.loads(stored or '{}').get('wpm'), 'stored_sent': json.loads(stored or '{}').get('sent'),
                         'errors': errors}
        ctx.close()
    b.close()
print(json.dumps(results, indent=1, ensure_ascii=False))
