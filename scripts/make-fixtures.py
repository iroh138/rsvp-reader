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

# jpx.pdf: a JPEG 2000 picture between two paragraphs on page 2 (decoded by wasm in pdf.js 4+, by JS in 3.x).
# Written by hand because reportlab cannot embed JPEG 2000.
def jpx_pdf(path):
    buf = io.BytesIO()
    img = Image.new('RGB', (240, 150))
    px = img.load()
    for x in range(240):
        for y in range(150):
            px[x, y] = (x % 256, (y * 2) % 256, (x + y) % 256)
    img.save(buf, 'JPEG2000', irreversible=False)
    jp2 = buf.getvalue()
    objs = []
    def page_content(n, with_image):
        lines = [f'BT /F1 9 Tf 40 565 Td (FIXTURE JPX) Tj ET', f'BT /F1 9 Tf 205 25 Td ({n}) Tj ET',
                 f'BT /F1 11 Tf 40 525 Td (Page {n} opens with ordinary words before anything else.) Tj ET',
                 'BT /F1 11 Tf 40 509 Td (The paragraph goes on for one more line and stops.) Tj ET']
        if with_image:
            lines += ['q 300 0 0 190 60 300 cm /Im1 Do Q', 'BT /F1 11 Tf 40 270 Td (After the picture the story simply continues.) Tj ET']
        else:
            lines += ['BT /F1 11 Tf 40 480 Td (Nothing else happens on this page at all.) Tj ET']
        return '\n'.join(lines).encode()
    n_pages = 4
    # 1 catalog, 2 pages, 3 font, 4 image, then (page, content) pairs
    page_ids = [5 + 2 * i for i in range(n_pages)]
    objs.append(b'<< /Type /Catalog /Pages 2 0 R >>')
    objs.append(('<< /Type /Pages /Count %d /Kids [%s] >>' % (n_pages, ' '.join(f'{p} 0 R' for p in page_ids))).encode())
    objs.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
    objs.append(b'<< /Type /XObject /Subtype /Image /Width 240 /Height 150 /Filter /JPXDecode /Length %d >>\nstream\n' % len(jp2) + jp2 + b'\nendstream')
    for i in range(n_pages):
        c = page_content(i + 1, i == 1)
        objs.append(('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 595] /Resources << /Font << /F1 3 0 R >> /XObject << /Im1 4 0 R >> >> /Contents %d 0 R >>' % (page_ids[i] + 1)).encode())
        objs.append(b'<< /Length %d >>\nstream\n' % len(c) + c + b'\nendstream')
    out_b = bytearray(b'%PDF-1.5\n%\xe2\xe3\xcf\xd3\n')
    offsets = []
    for k, o in enumerate(objs, 1):
        offsets.append(len(out_b)); out_b += b'%d 0 obj\n' % k + o + b'\nendobj\n'
    xref = len(out_b)
    out_b += b'xref\n0 %d\n0000000000 65535 f \n' % (len(objs) + 1)
    for off in offsets: out_b += b'%010d 00000 n \n' % off
    out_b += b'trailer\n<< /Size %d /Root 1 0 R /Info << /Title (Fixture JPX) >> >>\nstartxref\n%d\n%%%%EOF\n' % (len(objs) + 1, xref)
    open(path, 'wb').write(bytes(out_b))
jpx_pdf(os.path.join(out, 'jpx.pdf'))

# ---------------------------------------------------------------------------------------------------------------
# dropcap.pdf (N4, docs/pdf-corpus.md): a chapter title, a subtitle and a paragraph opening with a large drop cap "A". The cap is
# written FIRST in the file, before the title, as some layout tools do, so naive reading order is "A", title, "n ...".
# Also an ellipsis between two words without spaces ("odjednom...polete").
c = canvas.Canvas(os.path.join(out, 'dropcap.pdf'), pagesize=A5, invariant=1)
c.setTitle('Fixture Drop Cap')
body = ['n important question I love is: What have you experienced that',
        'makes you believe what you do? And would I believe the same',
        'if I experienced what you have? The answer is usually yes, and',
        'it explains more disagreements than anything else I know of.',
        'Ptice su odjednom...polete sa grane, i sve je utihnulo.']
for page in range(2):
    if page == 0:
        c.setFont('Times-Roman', 40); c.drawString(40, H - 186, 'A')                       # the cap, written first
        c.setFont('Times-Bold', 15); c.drawString(40, H - 70, 'ALL BEHAVIOR MAKES SENSE WITH')
        c.drawString(40, H - 88, 'ENOUGH INFORMATION')
        c.setFont('Times-BoldItalic', 11); c.drawString(40, H - 115, 'Most debates are people with different lives talking.')
        y = H - 172
        for k, ln in enumerate(body):
            c.setFont('Times-Roman', 11); c.drawString(70 if k < 2 else 40, y, ln); y -= 14
    else:
        # second chapter: a cap that is a word of its own ("I" + "once"), and a heading set as "M ONEY" (N7)
        c.setFont('Times-Roman', 40); c.drawString(40, H - 186, 'I')
        c.setFont('Times-Bold', 15); c.drawString(40, H - 70, 'M ONEY AND STATUS')
        c.setFont('Times-Roman', 11); y = H - 172
        for k, ln in enumerate(['once heard someone say that a nicer car is better money', 'spent, and once you drive it you know.',
                                'Money once spent on status is money once spent on others.']):
            c.drawString(55 if k < 2 else 40, y, ln); y -= 14
    c.showPage()
c.save()
print('wrote', os.path.abspath(os.path.join(out, 'dropcap.pdf')))

# ---------------------------------------------------------------------------------------------------------------
# Long books for performance (tests/e2e/perf.py) and for checking a phone (docs/platforms.md): 300 and 1000 pages,
# ~380 words per page, running header and page number. In a subfolder, so the PDF corpus check does not import them.
perf = os.path.join(out, 'perf')
os.makedirs(perf, exist_ok=True)
VOCAB = ('the of and to in a is that for it as was with be by on not he this are or his from at which but have an they '
         'you were her she there their one all we can has more if will would been when who so no out what said up its about '
         'into them than some could time these two may first then do any like my now over such our man me even most made '
         'after also did many before must through back years where much your way well down should because each just those '
         'people how too little state good very make world still own see men work long get here between both life being '
         'under never day same another know while last might us great old year off come since against go came right used').split()
for n in (300, 1000):
    rnd = random.Random(n)
    path = os.path.join(perf, f'long-{n}.pdf')
    c = canvas.Canvas(path, pagesize=A5, invariant=1)
    c.setTitle(f'Long Book {n}')
    for p in range(n):
        c.setFont('Helvetica', 8); c.drawString(40, H - 20, 'A LONG TEST BOOK'); c.drawCentredString(W / 2, 20, str(p + 1))
        c.setFont('Times-Roman', 10)
        y = H - 45
        for k in range(36):
            ws = [rnd.choice(VOCAB) for _ in range(rnd.randint(9, 12))]
            if rnd.random() < 0.25: ws[-1] += '.'
            c.drawString(52 if k % 9 == 0 else 40, y, ' '.join(ws)); y -= 14.5
        c.showPage()
    c.save()
    print('wrote', os.path.abspath(path))
