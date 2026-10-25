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
