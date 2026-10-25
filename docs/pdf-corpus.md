# Korpus testnih PDF-ova i nalazi

Datum: 2026-10-25 · pdf.js 3.11.174 · Generator: `scripts/make-fixtures.py` (determinističan) · Provera: `tests/e2e/pdf-corpus.py`

`tests/fixtures/golden.json` beleži kako **trenutni** kod obrađuje svaki fajl: poruku, šta je sačuvano u IndexedDB-u (hash teksta po stranici, broj reči i oznaka, uklonjena zaglavlja, slike) i rezultat in-app provera. Golden **nije** „tačno ponašanje“, nego referenca. Svaka razlika posle izmene koda ili nadogradnje pdf.js-a se prijavljuje, i čovek odlučuje da li je poboljšanje ili regresija. Posle prihvaćene izmene golden se ponovo snima sa `--write`.

| Fajl | Šta testira | Rezultat (3.11.174) |
|---|---|---|
| `book.pdf` | Zaglavlje, brojevi strana, reč rastavljena preko strane, pasusi | Dodato, 739 reči; zaglavlje i brojevi uklonjeni; sve provere OK |
| `images.pdf` | Slika usred strane; mali ornament (dekoracija) | Dodato; slika pozicionirana na strani 2, ornament ignorisan; provera slike OK. **Nalaz N1** |
| `cyrillic.pdf` | Srpska ćirilica i latinica, ugrađen font | Dodato; zaglavlje uklonjeno; tap-to-word 20/20. **Nalaz N2** |
| `encrypted.pdf` | PDF sa lozinkom (T1.3) | Poruka o lozinki; ništa nije sačuvano |
| `scanned.pdf` | Samo slike, bez teksta (T1.3) | Poruka „no text layer“; ništa nije sačuvano |
| `notpdf.pdf` | Tekst sa `.pdf` nastavkom (T1.3) | „not a valid PDF file“; ništa nije sačuvano |
| `truncated.pdf` | Prekinuto preuzimanje (60 % fajla) | „damaged“; ništa nije sačuvano |
| `garbage.pdf` | Ispravno zaglavlje + nasumični bajtovi | „damaged“; ništa nije sačuvano; bez grešaka na stranici |

Zlonamerni PDF koji koristi CVE-2024-4367 namerno **nije** deo korpusa, jer bi to bio exploit. Zaštitu proverava statički test (`tests/pdf-loading.test.mjs`: `isEvalSupported: false` na svakom pozivu `getDocument`), a ranjivu verziju uklanja nadogradnja pdf.js.

## Nalazi u postojećem kodu (nisu ispravljeni u ovom PR-u)

**N1 — Tekst knjige se tiho preskače (visok prioritet).** Prvi red tela strane („Page 1 begins with a short paragraph of plain words.“) uklanja se na **svakoj** strani kao „page numbers“:
- kratak je (≤ 12 reči);
- nalazi se među dva gornja reda;
- sadrži broj koji raste sa stranom (pravilo B u `applyCleanup`, `src/core.js`).

Čitač zato preskače stvarne rečenice, a korisnik to ne vidi. U stvarnim knjigama ovo je ređe, jer red mora da sadrži broj jednak broju strane plus stalan pomak, na istoj visini, na bar 3 strane. Ali kada se desi, gubi se tekst, što je najgori ishod za čitač.
- Predlog: pravilo B prihvata samo red u kome je broj (skoro) sav sadržaj, npr. „12“, „— 12 —“ ili „Page 12“, ili red odvojen od tela razmakom većim od proreda, kao kod pravila A.
- Ispravka zahteva izmenu golden-a, pa ide kao zaseban PR.

**N2 — Lažno upozorenje za tekst koji nije na engleskom (srednji prioritet).** Za `cyrillic.pdf` (ispravan srpski tekst) aplikacija postavlja `garbled = true` i prikazuje „The text looks garbled or is not English“. Detekcija broji česte **engleske** reči (`COMMON`, `src/app.js`). Za ciljno tržište (Srbija + globalno) ovo znači da svaka knjiga na srpskom ili nekom drugom jeziku dobija upozorenje. Ovo potvrđuje pretpostavku iz faze 1 (`docs/phase-1/01-validacija-potrebe.md`, H7 i napomena o heuristikama).
- Predlog: meriti udeo znakova koji nisu slova ili su „private use“, umesto engleskih reči.
