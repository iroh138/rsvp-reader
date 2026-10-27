"""Reading stops when the reader is scrolled out of view (owner's device test, 2026-10-25), and only then.
Phone-sized viewport. Usage: python3 tests/e2e/scroll-pause.py http://localhost:8080/"""
import sys, json, re, os
from playwright.sync_api import sync_playwright

url = sys.argv[1]
pdf = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures', 'book.pdf')

def advancing(pg, ms=1000):
    # the shown word changes at least twice in `ms` when reading (300 wpm = 5 words a second)
    seen = set()
    for _ in range(5):
        seen.add(pg.inner_text('#row')); pg.wait_for_timeout(ms // 5)
    return len(seen) >= 3

out = {}
with sync_playwright() as p:
    b = p.chromium.launch()
    def fresh():
        ctx = b.new_context(viewport={'width': 393, 'height': 851}, is_mobile=True, has_touch=True)
        pg = ctx.new_page(); pg.goto(url + '?dev', wait_until='load'); pg.wait_for_timeout(500)
        pg.click('#loadBtn'); pg.wait_for_timeout(300); pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(300)
        return ctx, pg

    ctx, pg = fresh()
    pg.click('#playBtn'); pg.wait_for_timeout(1200)
    out['plays_when_visible'] = advancing(pg)
    pg.evaluate('window.scrollTo(0, document.body.scrollHeight)'); pg.wait_for_timeout(700)
    out['state_after_scroll_away'] = pg.inner_text('#stateLabel')
    out['stopped_after_scroll_away'] = not advancing(pg)
    pg.evaluate('window.scrollTo(0, 0)'); pg.wait_for_timeout(700)
    out['no_auto_resume_on_return'] = not advancing(pg)
    ctx.close()

    ctx, pg = fresh()                                   # negative: a small scroll keeps the reader on screen
    pg.click('#playBtn'); pg.wait_for_timeout(1200)
    pg.evaluate('window.scrollBy(0, 60)'); pg.wait_for_timeout(700)
    out['small_scroll_keeps_reading'] = advancing(pg)
    ctx.close()

    ctx, pg = fresh()                                   # Space while scrolled away brings the reader back and reads
    pg.evaluate('window.scrollTo(0, document.body.scrollHeight)'); pg.wait_for_timeout(500)
    pg.keyboard.press('Space'); pg.wait_for_timeout(1500)
    out['space_while_away_scrolls_back_and_reads'] = advancing(pg)
    ctx.close()

    ctx, pg = fresh()                                   # focus mode covers the screen: scrolling the page does not stop it
    pg.click('#focusBtn'); pg.wait_for_timeout(500)
    pg.keyboard.press('Space'); pg.wait_for_timeout(1200)
    pg.evaluate('window.scrollTo(0, document.body.scrollHeight)'); pg.wait_for_timeout(700)
    out['focus_mode_keeps_reading'] = advancing(pg)
    ctx.close()

    ctx, pg = fresh()                                   # "Read from here" in the document view still starts reading
    pg.set_input_files('#fileIn', pdf)
    pg.wait_for_function("() => (document.querySelector('#libMsg').textContent||'').startsWith('Added')", timeout=60000); pg.wait_for_timeout(2500)
    span = pg.locator('#pages .textLayer span').nth(30)
    span.scroll_into_view_if_needed(); span.click(); pg.wait_for_timeout(300)
    pg.click('#readHereBtn'); pg.wait_for_timeout(4500)
    out['read_from_here_reads'] = advancing(pg)
    ctx.close()
    b.close()

print(json.dumps(out, indent=1))
ok = all(v for k, v in out.items() if k != 'state_after_scroll_away') and out['state_after_scroll_away'].lower() == 'paused'
sys.exit(0 if ok else 1)
