"""Generates test PDFs in tests/fixtures/ (deterministic, no external text).
book.pdf: 8 pages, running header, page numbers, a word hyphenated across a page break, paragraphs.
Run: python3 scripts/make-fixtures.py (needs reportlab)."""
import os
from reportlab.lib.pagesizes import A5
from reportlab.pdfgen import canvas

out = os.path.join(os.path.dirname(__file__), '..', 'tests', 'fixtures')
os.makedirs(out, exist_ok=True)
W, H = A5
c = canvas.Canvas(os.path.join(out, 'book.pdf'), pagesize=A5, invariant=1)
c.setTitle('Fixture Book')
words = ('The quick reader moves through every line of this small test book, one word at a time. '
         'Each page carries a running header and a page number that the reader should skip. ').split()
for p in range(8):
    c.setFont('Helvetica', 9)
    c.drawString(40, H - 30, 'FIXTURE BOOK')               # running header
    c.drawCentredString(W / 2, 25, str(p + 1))             # page number
    c.setFont('Helvetica', 11)
    y = H - 70
    lines = []
    for k in range(14):
        lines.append(' '.join(words[(k * 5 + p) % len(words):][:7]) or 'filler words here')
    if p == 2:
        lines[-1] = lines[-1] + ' extra-'                   # hyphenated across the page break
    if p == 3:
        lines[0] = 'ordinary words continue the sentence.'
    for i, ln in enumerate(lines):
        x = 58 if i in (0, 7) else 40                      # indented first lines = paragraph starts
        c.drawString(x, y, ln)
        y -= 16
    c.showPage()
c.save()
print('wrote', os.path.abspath(os.path.join(out, 'book.pdf')))

# ---------------------------------------------------------------------------------------------------------------
# Corpus for pdf.js upgrades and for negative import tests (T1.3, SEC-03). Every file is deterministic.
import io, random
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.utils import ImageReader
from PIL import Image

def body(c, lines, y0, font='Helvetica', size=11, indent=(0,)):
    c.setFont(font, size)
    y = y0
    for i, ln in enumerate(lines):
        c.drawString(58 if i in indent else 40, y, ln)
        y -= 16
    return y

def picture(w, h, seed):
    rnd = random.Random(seed)
    img = Image.new('RGB', (w, h))
    px = img.load()
    a, b = rnd.randrange(256), rnd.randrange(256)
    for x in range(w):
        for y in range(h):
            px[x, y] = ((x * 255 // w + a) % 256, (y * 255 // h + b) % 256, (x + y) % 256)
    buf = io.BytesIO(); img.save(buf, 'PNG'); buf.seek(0)
    return ImageReader(buf)

# images.pdf: a figure in the middle of page 2, a small ornament on page 4 (decoration, must not pause reading)
c = canvas.Canvas(os.path.join(out, 'images.pdf'), pagesize=A5, invariant=1)
c.setTitle('Fixture Images')
for p in range(5):
    c.setFont('Helvetica', 9); c.drawString(40, H - 30, 'FIXTURE IMAGES'); c.drawCentredString(W / 2, 25, str(p + 1))
    y = body(c, [f'Page {p + 1} begins with a short paragraph of plain words.', 'It continues on a second line and ends here.'], H - 70)
    if p == 1:
        c.drawImage(picture(320, 200, 7), 60, y - 210, width=300, height=190)
        y -= 230
        body(c, ['The text after the figure continues the story.'], y)
    elif p == 3:
        c.drawImage(picture(16, 16, 3), W / 2 - 6, y - 16, width=12, height=12)
        body(c, ['A small ornament sits above this line.'], y - 34)
    else:
        body(c, ['More ordinary words fill the rest of this page.'], y - 4)
    c.showPage()
c.save()

# cyrillic.pdf: Serbian Cyrillic and Latin with an embedded font (DejaVu Serif, Bitstream Vera licence)
pdfmetrics.registerFont(TTFont('DejaVuSerif', '/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf'))
c = canvas.Canvas(os.path.join(out, 'cyrillic.pdf'), pagesize=A5, invariant=1)
c.setTitle('Ћирилица')
cyr = 'Читач приказује једну по једну реч, а пауза на крају реченице даје време да се мисао заврши. Ђак, шума, жаба, ћуп, џеп.'.split()
lat = 'Čitač prikazuje jednu po jednu reč, a pauza na kraju rečenice daje vreme da se misao završi. Đak, šuma, žaba, ćup, džep.'.split()
for p in range(6):
    c.setFont('DejaVuSerif', 9); c.drawString(40, H - 30, 'ЋИРИЛИЦА'); c.drawCentredString(W / 2, 25, str(p + 1))
    words = cyr if p % 2 == 0 else lat
    lines = [' '.join(words[(k * 4 + p) % len(words):][:6]) or 'реч' for k in range(12)]
    body(c, lines, H - 70, font='DejaVuSerif', indent=(0, 6))
    c.showPage()
c.save()

# encrypted.pdf: needs a password (expected: "password-protected" message, nothing saved)
c = canvas.Canvas(os.path.join(out, 'encrypted.pdf'), pagesize=A5, invariant=1, encrypt='fixture-password')
body(c, ['This page is locked with a password.'], H - 70); c.showPage(); c.save()

# scanned.pdf: pictures of pages, no text layer (expected: "no text layer" message, nothing saved)
c = canvas.Canvas(os.path.join(out, 'scanned.pdf'), pagesize=A5, invariant=1)
for p in range(3):
    c.drawImage(picture(120, 170, 100 + p), 0, 0, width=W, height=H); c.showPage()
c.save()

# notpdf.pdf: a text file with a .pdf name (expected: "not a valid PDF file")
with open(os.path.join(out, 'notpdf.pdf'), 'w') as f:
    f.write('This is plain text pretending to be a PDF.\n')

# truncated.pdf: the first 60 % of book.pdf, as from an interrupted download
data = open(os.path.join(out, 'book.pdf'), 'rb').read()
open(os.path.join(out, 'truncated.pdf'), 'wb').write(data[: len(data) * 6 // 10])

# garbage.pdf: a valid header followed by random bytes (expected: "damaged" message)
rnd = random.Random(42)
open(os.path.join(out, 'garbage.pdf'), 'wb').write(b'%PDF-1.7\n' + bytes(rnd.randrange(256) for _ in range(20000)))
print('wrote corpus to', os.path.abspath(out))
