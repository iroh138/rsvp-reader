"""Headless smoke test: load the app, run the in-app checks, collect results and console errors.
Usage: python3 smoke.py <url> [--dev]"""
import sys, json
from playwright.sync_api import sync_playwright

url = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch()
    pg = b.new_page()
    errors, external = [], []
    pg.on("console", lambda m: m.type == "error" and errors.append(m.text))
    pg.on("pageerror", lambda e: errors.append("pageerror: " + str(e)))
    pg.on("request", lambda r: (not r.url.startswith(url.split("?")[0].rsplit("/", 1)[0])) and not r.url.startswith(("data:", "blob:")) and external.append(r.url))
    pg.goto(url, wait_until="load")
    pg.wait_for_timeout(1500)
    out = {"title": pg.title(), "checkBtnVisible": pg.is_visible("#checkBtn"), "tagVisible": pg.locator(".top .tag").count() and pg.is_visible(".top .tag")}
    # read the sample text and play a few words
    pg.click("#loadBtn")
    pg.wait_for_timeout(300)
    out["meta"] = pg.inner_text("#meta")
    if pg.is_visible("#checkBtn"):
        pg.click("#checkBtn")
        pg.wait_for_function("document.querySelectorAll('#results .res').length > 0 && !document.querySelector('#checkBtn').disabled", timeout=60000)
        pg.wait_for_timeout(2000)
        out["results"] = [ (r.get_attribute("class").split()[-1], r.locator(".txt").inner_text().split("\n")[0][:110]) for r in pg.locator("#results .res").all()]
    # PDF import, then the book-based checks
    pdf = sys.argv[2] if len(sys.argv) > 2 else None
    if pdf:
        pg.set_input_files("#fileIn", pdf)
        pg.wait_for_function("(document.querySelector('#libMsg').textContent||'').length > 0", timeout=60000)
        out["import"] = pg.inner_text("#libMsg")
        pg.wait_for_timeout(1500)
        out["books"] = pg.locator("#books .book .t").all_inner_texts()
        if pg.is_visible("#checkBtn"):
            pg.locator("#results").evaluate("e => e.innerHTML = ''")
            pg.click("#checkBtn")
            pg.wait_for_function("document.querySelectorAll('#results .res').length > 0 && !document.querySelector('#checkBtn').disabled", timeout=60000)
            pg.wait_for_timeout(4000)
            out["pdf_results"] = [ (r.get_attribute("class").split()[-1], r.locator(".txt").inner_text().split("\n")[0][:110]) for r in pg.locator("#results .res").all()]
    pg.keyboard.press("Space"); pg.wait_for_timeout(1200); pg.keyboard.press("Space")
    out["wordShown"] = pg.inner_text("#row")
    out["errors"] = errors
    out["external_requests"] = sorted(set(external))
    print(json.dumps(out, indent=1, ensure_ascii=False))
    b.close()
