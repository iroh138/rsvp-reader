"""Keyboard-only use (QA-03, WCAG 2.1.1, 2.4.3, 2.4.7): the critical flow works without a mouse, every control is
reachable with Tab, and the focused element always shows a visible focus outline.
Flow: Add PDF (Enter opens the file chooser) -> play/pause -> sentence step -> speed -> focus mode -> document view
-> choose a start word with the arrow keys -> Enter reads from exactly that word -> delete the book (two Enters).
Usage: python3 tests/e2e/keyboard.py http://localhost:8080/"""
import sys, json, os
from playwright.sync_api import sync_playwright

url = sys.argv[1]
fx = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'fixtures')
FOCUS = """() => { const e = document.activeElement; if (!e || e === document.body) return null;
  const s = getComputedStyle(e); const w = parseFloat(s.outlineWidth) || 0;
  return { el: e.id || (e.textContent.trim() + ' ' + (e.closest('li') ? e.closest('li').querySelector('.t').textContent : '')).trim() || e.tagName, visible: (s.outlineStyle !== 'none' && w >= 2) || (s.boxShadow && s.boxShadow !== 'none') }; }"""
out, ok = {}, {}
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page(viewport={'width': 1280, 'height': 900})
    pg.goto(url, wait_until='load'); pg.evaluate('navigator.serviceWorker.ready'); pg.wait_for_timeout(500)

    # Tab until "Add PDF", Enter must open the file chooser
    for _ in range(40):
        pg.keyboard.press('Tab')
        if pg.evaluate('() => document.activeElement.id') == 'addBtn': break
    with pg.expect_file_chooser() as fc:
        pg.keyboard.press('Enter')
    fc.value.set_files(os.path.join(fx, 'book.pdf'))
    pg.wait_for_function("() => document.querySelector('#libMsg').textContent.startsWith('Added')", timeout=60000)
    ok['add_pdf_by_keyboard'] = True

    # Every control is reachable with Tab, with a visible focus outline
    pg.evaluate("() => document.activeElement.blur()")
    seen, invisible = [], []
    for _ in range(80):
        pg.keyboard.press('Tab')
        f = pg.evaluate(FOCUS)
        if not f: continue
        if seen and f['el'] == seen[0]: break
        seen.append(f['el'])
        if not f['visible']: invisible.append(f['el'])
    controls = pg.evaluate("""() => [...document.querySelectorAll('button, input:not([type=file]), textarea, [tabindex="0"], a[href]')]
      .filter(e => e.offsetParent !== null && !e.disabled && !e.closest('[data-dev]')).map(e => e.id || (e.textContent.trim() + ' ' + (e.closest('li') ? e.closest('li').querySelector('.t').textContent : '')).trim() || e.tagName)""")
    out['tab_order'] = seen; out['no_visible_focus'] = invisible
    out['not_reachable'] = [c for c in controls if c not in seen]
    ok['all_reachable'] = not out['not_reachable']; ok['focus_visible'] = not invisible

    # Reader keys
    pg.evaluate("() => document.activeElement.blur()")
    meta0 = pg.inner_text('#meta')
    pg.keyboard.press('Space'); pg.wait_for_timeout(800)
    playing = pg.inner_text('#stateLabel')
    pg.keyboard.press('Space'); pg.wait_for_timeout(200)
    paused = pg.inner_text('#stateLabel')
    w0 = pg.inner_text('#wpmOut'); pg.keyboard.press('ArrowUp'); w1 = pg.inner_text('#wpmOut')
    pg.keyboard.press('ArrowRight'); pg.wait_for_timeout(200); meta1 = pg.inner_text('#meta')
    pg.keyboard.press('f'); pg.wait_for_timeout(300); focus_on = pg.evaluate("() => document.querySelector('#reader').classList.contains('focus')")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300); focus_off = not pg.evaluate("() => document.querySelector('#reader').classList.contains('focus')")
    out['reader_keys'] = {'play': playing, 'pause': paused, 'wpm': [w0, w1], 'meta': [meta0, meta1]}
    ok['reader_keys'] = playing != paused and w0 != w1 and focus_on and focus_off

    # Document view: choose a word with the keyboard and read from it
    pg.focus('#docBtn'); pg.keyboard.press('Enter'); pg.wait_for_timeout(1500)
    pg.focus('#docScroll')
    for _ in range(5): pg.keyboard.press('ArrowRight')
    pg.keyboard.press('ArrowDown')
    pg.wait_for_timeout(300)
    label = pg.inner_text('#pickLabel')
    picked = label.split('”')[0].lstrip('“')
    pg.keyboard.press('Enter'); pg.wait_for_timeout(250)
    shown = pg.evaluate("() => document.querySelector('#row').textContent")
    pg.wait_for_timeout(2000); pg.keyboard.press('Space')
    out['pick'] = {'label': label, 'first_word_shown': shown}
    ok['keyboard_pick'] = bool(picked) and shown == picked and 'word' in label

    # Delete the book: Enter, then Enter again to confirm
    pg.locator('#books .book .acts button', has_text='Delete').focus(); pg.keyboard.press('Enter'); pg.keyboard.press('Enter'); pg.wait_for_timeout(500)
    out['after_delete'] = pg.evaluate("() => document.querySelector('#libMsg').textContent")
    ok['delete_by_keyboard'] = out['after_delete'].startswith('Deleted')
    b.close()
print(json.dumps(out, indent=1, ensure_ascii=False)); print(json.dumps(ok))
sys.exit(0 if all(ok.values()) else 1)
