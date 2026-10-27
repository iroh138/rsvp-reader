# Korpus testnih PDF-ova i nalazi

Datum: 2026-10-25 · Golden snimljen sa pdf.js 3.11.174 · Generator: `scripts/make-fixtures.py` (determinističan) · Provera: `tests/e2e/pdf-corpus.py`

`tests/fixtures/golden.json` beleži kako **trenutni** kod obrađuje svaki fajl: poruku, šta je sačuvano u IndexedDB-u (hash teksta po stranici, broj reči i oznaka, uklonjena zaglavlja, slike) i rezultat in-app provera. Golden **nije** „tačno ponašanje“, nego referenca. Svaka razlika posle izmene koda ili nadogradnje pdf.js-a se prijavljuje, i čovek odlučuje da li je poboljšanje ili regresija. Posle prihvaćene izmene golden se ponovo snima sa `--write`.

| Fajl | Šta testira | Rezultat (3.11.174) |
|---|---|---|
| `book.pdf` | Zaglavlje, brojevi strana, reč rastavljena preko strane, pasusi | Dodato, 739 reči; zaglavlje i brojevi uklonjeni; sve provere OK |
| `jpx.pdf` | Slika u formatu JPEG 2000 (u pdf.js 4+ je dekodira WebAssembly) | Dodato; slika pozicionirana i iscrtana. **N1** se ponavlja (prvi red strane) |
| `images.pdf` | Slika usred strane; mali ornament (dekoracija) | Dodato; slika pozicionirana na strani 2, ornament ignorisan; provera slike OK. **Nalaz N1** |
| `cyrillic.pdf` | Srpska ćirilica i latinica, ugrađen font | Dodato; zaglavlje uklonjeno; tap-to-word 20/20. **Nalaz N2** |
| `encrypted.pdf` | PDF sa lozinkom (T1.3) | Poruka o lozinki; ništa nije sačuvano |
| `scanned.pdf` | Samo slike, bez teksta (T1.3) | Poruka „no text layer“; ništa nije sačuvano |
| `notpdf.pdf` | Tekst sa `.pdf` nastavkom (T1.3) | „not a valid PDF file“; ništa nije sačuvano |
| `truncated.pdf` | Prekinuto preuzimanje (60 % fajla) | „damaged“; ništa nije sačuvano |
| `garbage.pdf` | Ispravno zaglavlje + nasumični bajtovi | „damaged“; ništa nije sačuvano; bez grešaka na stranici |

Zlonamerni PDF koji koristi CVE-2024-4367 namerno **nije** deo korpusa, jer bi to bio exploit. Zaštitu proverava statički test (`tests/pdf-loading.test.mjs`: `isEvalSupported: false` na svakom pozivu `getDocument`), a ranjivu verziju uklanja nadogradnja pdf.js.

## Nalazi u postojećem kodu (nisu ispravljeni u ovom PR-u)

**N1 — Tekst knjige se tiho preskače (visok prioritet). ISPRAVLJENO 2026-10-25** (vidi dole). Prvi red tela strane („Page 1 begins with a short paragraph of plain words.“) uklanja se na **svakoj** strani kao „page numbers“:
- kratak je (≤ 12 reči);
- nalazi se među dva gornja reda;
- sadrži broj koji raste sa stranom (pravilo B u `applyCleanup`, `src/core.js`).

Čitač zato preskače stvarne rečenice, a korisnik to ne vidi. U stvarnim knjigama ovo je ređe, jer red mora da sadrži broj jednak broju strane plus stalan pomak, na istoj visini, na bar 3 strane. Ali kada se desi, gubi se tekst, što je najgori ishod za čitač.
- Predlog: pravilo B prihvata samo red u kome je broj (skoro) sav sadržaj, npr. „12“, „— 12 —“ ili „Page 12“, ili red odvojen od tela razmakom većim od proreda, kao kod pravila A.
- Ispravka zahteva izmenu golden-a, pa ide kao zaseban PR.

**N2 — Lažno upozorenje za tekst koji nije na engleskom (srednji prioritet). ISPRAVLJENO 2026-10-25** (vidi dole). Za `cyrillic.pdf` (ispravan srpski tekst) aplikacija postavlja `garbled = true` i prikazuje „The text looks garbled or is not English“. Detekcija broji česte **engleske** reči (`COMMON`, `src/app.js`). Za ciljno tržište (Srbija + globalno) ovo znači da svaka knjiga na srpskom ili nekom drugom jeziku dobija upozorenje. Ovo potvrđuje pretpostavku iz faze 1 (`docs/phase-1/01-validacija-potrebe.md`, H7 i napomena o heuristikama).
- Predlog: meriti udeo znakova koji nisu slova ili su „private use“, umesto engleskih reči.

## Nadogradnja na pdf.js 6.4.299 (2026-10-25)

- **Svih 9 fajlova je identično golden-u iz 3.11:** isti tekst po stranici, iste oznake, uklonjena zaglavlja, pozicije slika, poruke i in-app provere.
- Nadogradnja sa 3.11 builda za `book.pdf`, `images.pdf`, `cyrillic.pdf` i `jpx.pdf`: knjige uvezene starom verzijom rade u novoj, uključujući tap-to-word 20/20 (16/16 za `jpx.pdf`) i prikaz slike.
- Korpus je uhvatio regres koji bi inače otišao u produkciju: `PageViewport.convertToViewportRectangle` ne postoji u 4+, pa se slika iz knjige nije iscrtavala. Ispravljeno pomoćnom funkcijom `viewportRect` (`src/core.js`, sa testom).
- **In-app provera slike je davala lažan „OK“ za prazno platno.** Providan piksel (0,0,0,0) je računala kao „iscrtano“. Sada traži bar dve različite neprovidne boje. Proverom je potvrđeno da bez wasm dekodera JPEG 2000 slika ostaje prazna (1 boja), a sa njima se iscrtava (6.876 boja u uzorku). Zato se wasm isporučuje.

## Ispravka N1 (2026-10-25)

- Pravilo B (`applyCleanup`, `src/core.js`) prihvata red sa brojem strane samo ako je odvojen od teksta većim razmakom, ili ako pored broja ima najviše `MAX_WORDS_BESIDE_NUMBER = 3` reči („Page 12“, „— 12 —“, „12 The Book Title“).
- Unit testovi: negativni („Page 12 begins with …“ se ne uklanja; test pada na starom kodu) i pozitivni (gol broj sa i bez razmaka, kratki redovi sa brojem i dalje se uklanjaju).
- Golden je ponovo snimljen. Promenjeni su **samo** `images.pdf` (preskočeno 65 → 15 reči: 5 zaglavlja × 2 + 5 brojeva) i `jpx.pdf` (48 → 12). `book.pdf` i `cyrillic.pdf` su nepromenjeni.
- **Poznato ograničenje (N3, nizak prioritet):** na stranicama sa vrlo malo redova levu marginu određuje najčešći početak reda. Ako su skoro svi redovi uvučeni, uvlačenje se ne prepoznaje kao novi pasus. Zato je u `images.pdf` broj pasusa pao sa 5 na 2. Ranije je to bilo slučajno „tačno“, jer je jedan red pogrešno bio izbačen. Realne stranice sa desetinama redova nisu pogođene (`book.pdf`: 14 pasusa, nepromenjeno).

## Ispravka N2 (2026-10-25)

- `textQuality` (`src/core.js`) više ne broji engleske reči. Traži strukturne tragove pokvarenog izvoza teksta, nezavisne od jezika:
  - neobični znakovi (private use, `U+FFFD`, kontrolni) > 2 %;
  - simboli umesto slova > 15 %;
  - reči koje mešaju latinicu, ćirilicu i grčko pismo > 10 % (delovi oko crtice se gledaju posebno, pa „PDF-а“ je u redu);
  - „reči“ od 40+ slova > 10 % (nedostaju razmaci).
- Testovi: ispravan tekst na engleskom, srpskoj latinici i ćirilici, nemačkom (sa namerno ekstremnim složenicama), francuskom, grčkom i kineskom, kao i tabela sa brojevima, nije označen. Pet tipova pokvarenog teksta jeste, uz razlog. Prag za „reč bez razmaka“ je podignut sa 30 na 40 slova posle testa sa nemačkim složenicama.
- **Poznato ograničenje:** tekst u kom su slova zamenjena drugim slovima („Wkh txlfn“) nema strukturni trag i ne otkriva se. Test to eksplicitno beleži.
- `PROCESSOR_VERSION` 4 → 5: već uvezene knjige se pri prvom otvaranju jednom ponovo obrade. Time dobijaju i ispravku N1, i ispravku N2. Testirano nadogradnjom:
  - srpska knjiga gubi upozorenje;
  - `images.pdf` uvezen pre ispravke N1 vraća izgubljene rečenice (preskočeno 65 → 15);
  - pozicija čitanja ostaje ista.
- Golden: promenjen je samo `cyrillic.pdf` (`garbled: true → false`).

## N4 i N5 — inicijal i tri tačke (prijavio vlasnik 2026-10-27, ISPRAVLJENO)

**N4 — Inicijal („drop cap“) se čitao odvojeno i na pogrešnom mestu.** U knjizi sa velikim početnim slovom pasusa („A“ pored „n important question…“) čitač je prikazivao „A“, pa naslov poglavlja, pa „n important…“. PDF čuva veliko slovo kao zaseban tekst, a neki alati ga upisuju u fajl pre naslova.
- Ispravka: `findDropCaps` (`src/core.js`) prepoznaje red koji sadrži samo jedno slovo (uz eventualni navodnik) i bar 1,8× je veći od teksta, a odmah desno od njega je red teksta čija je osnovna linija u visini slova. To slovo se čita kao početak prve reči tog reda („An“), a samo se više ne prikazuje. Tap na veliko slovo na strani bira „An“.
- Testovi: `tests/dropcap.test.mjs` (uključujući negativne: oznaka poglavlja „I“ iznad teksta, slovo normalne veličine, slovo daleko levo, slovo iznad teksta) i `tests/e2e/dropcap.py` sa `tests/fixtures/dropcap.pdf`. Svih 4 provera pada na starom kodu.
- Ograničenje: ako PDF upiše slovo i prvi red tako da ih izvlačenje teksta već spoji u isti red, ništa se ne menja (tada je čitanje već ispravno). Inicijal od više slova ili slika umesto slova se ne prepoznaje.

**N5 — Tri tačke između reči bez razmaka.** „odjednom...polete“ (i „…“) bila je jedna reč. Sada je to dve reči, „odjednom...“ i „polete“, sa pauzom kao na kraju rečenice, isto kao kada posle tri tačke stoji razmak. Brojevi („3...5“) i web adrese ostaju celi.

`PROCESSOR_VERSION` 5 → 6: već uvezene knjige se pri prvom otvaranju jednom ponovo obrade. N4 ne menja broj reči, pa pozicija ostaje ista. N5 dodaje po jednu reč za svako „reč...reč“ pre sačuvane pozicije. Pozicija je sačuvana kao redni broj reči, pa u takvoj knjizi pada za toliko reči ranije. To je obično 0–5 reči, a čitanje ionako pri nastavku vraća do početka rečenice.
Golden: dodat je samo `dropcap.pdf`; svih 9 postojećih fajlova je nepromenjeno.
