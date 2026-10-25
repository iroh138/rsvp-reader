"""PRV-04 browser check: no request leaves the origin, and the bundled fonts are the ones actually used.
Usage: python3 tests/e2e/fonts.py http://localhost:8080/"""
import sys, json
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright

url = sys.argv[1]
origin = '{0.scheme}://{0.netloc}'.format(urlparse(url))
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    external, errors = [], []
    pg.on('request', lambda r: (not r.url.startswith(origin)) and not r.url.startswith(('data:', 'blob:')) and external.append(r.url))
    pg.on('pageerror', lambda e: errors.append(str(e)))
    pg.goto(url + '?dev', wait_until='load')
    # Latin + Serbian Latin + Serbian Cyrillic in the reader and UI fonts
    pg.fill('#src', 'Čitač đak šuma — Читач ђак шума.')
    pg.click('#loadBtn')
    pg.evaluate("document.fonts.ready")
    pg.wait_for_timeout(1500)
    faces = pg.evaluate("""[...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/["']/g, '') + ' ' + f.weight + ' ' + f.unicodeRange.slice(0, 18))""")
    # the reader shows one word at a time, so the Cyrillic subset is fetched only when needed: request it explicitly
    pg.evaluate("Promise.all([document.fonts.load('400 48px Literata', 'Читач'), document.fonts.load('400 15px \"IBM Plex Sans\"', 'Читач')])")
    checks = pg.evaluate("""({
      literataLatin: document.fonts.check('400 48px Literata', 'Čitač'),
      literataCyrillic: document.fonts.check('400 48px Literata', 'Читач'),
      plexSans: document.fonts.check('400 15px "IBM Plex Sans"', 'Library'),
      plexMono: document.fonts.check('400 12px "IBM Plex Mono"', '300 wpm'),
    })""")
    out = {'external_requests': external, 'errors': errors, 'checks': checks, 'loaded_faces': sorted(set(faces))}
    print(json.dumps(out, indent=1, ensure_ascii=False))
    ok = not external and not errors and all(checks.values()) and any(f.startswith('Literata') for f in faces)
    b.close()
    sys.exit(0 if ok else 1)
