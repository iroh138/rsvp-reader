# PRD-03 — Pretpostavke i validacija potrebe

Datum: 2026-10-24 · Kod: `a44a0e2` · Metod: desk research (App Store stranice, patentne baze, dokumentacija Google/Paddle/Apple).
**Status: Delimično.** Desk research nije zamena za razgovore sa korisnicima. Validacija se zatvara tek posle koraka u §4.

## 1. Ključne pretpostavke

| # | Pretpostavka | Rizik ako je netačna | Rezultat provere |
|---|---|---|---|
| H1 | Postoji dovoljno ljudi koji žele RSVP čitanje celih knjiga | Nema tržišta | **Potvrđeno indirektno.** Outread ima ~1,4 hiljade ocena (4,7) i kombinaciju pretplate i doživotne licence. U 2026. izašlo je više novih RSVP aplikacija u App Store-u. |
| H2 | Postojeća rešenja ne podržavaju dobro PDF knjige | Nema diferencijacije | **Opovrgnuto u osnovnom obliku.** Strobe, Devour, Outread i „Speed Reader: RSVP Reader“ uvoze PDF, a većina i EPUB. |
| H3 | „Sve na uređaju, bez praćenja“ je razlikovni faktor | Slaba poruka | **Delimično opovrgnuto.** Strobe je besplatan, bez IAP-a, ne prikuplja podatke i radi offline. Outread i Devour koriste analitiku ili reklame, pa privatnost razlikuje proizvod samo od dela tržišta. |
| H4 | Kvalitet obrade PDF-a (uklanjanje zaglavlja i brojeva strana, spajanje reči preko preloma, slike na pravom mestu, start sa originalne stranice) je razlog za izbor | Diferencijacija ne postoji | **Neprovereno.** Nijedna pregledana stranica ne opisuje ove funkcije, ali to ne dokazuje da ih nemaju. Proverava se samo testom. |
| H5 | Korisnici žele Android i PC, ne samo iOS | Pogrešan redosled platformi | **Neprovereno.** Pretraga je vratila skoro isključivo iOS aplikacije; Android ponuda nije analizirana. |
| H6 | Korisnici će platiti | Nema prihoda | **Delimično.** Konkurenti naplaćuju (Outread: pretplata i doživotno; Devour: 1,99 $ mesečno / 14,99 $ godišnje), ali postoji i potpuno besplatan Strobe. |
| H7 | PDF-only je dovoljan za „cele knjige“ | Gubitak većine korisnika e-knjiga | **Rizik.** Konkurenti nude EPUB kao osnovni format. PDF-only je bila svesna odluka za ličnu upotrebu i treba je preispitati za tržište. |

## 2. Konkurencija (pregled App Store stranica)

| Aplikacija | Formati | Model | Privatnost (izjava developera) | Ocene |
|---|---|---|---|---|
| Outread | EPUB, PDF, DOCX, RTF, TXT (uz Outread+) | Free + pretplata / doživotno | Firebase analitika; sadržaj na uređaju | ~1,4 hiljade, 4,7 |
| Strobe | PDF, EPUB, TXT, Markdown | Besplatno, bez IAP-a | Ne prikuplja podatke; iCloud sync | 8, 4,9 |
| Speed Reader: RSVP Reader | EPUB; PDF i DOCX u Pro verziji | Free + pretplata / doživotno | „Ne prikuplja podatke“, uz anonimnu analitiku koja se može isključiti | 13, 4,1 |
| Devour | EPUB, PDF, DOCX, TXT, MD, HTML, RTF | Reklame + pretplata | Prati korisnika (Usage Data) | 1, 5,0 |

Ocene i cene važe na dan provere i menjaju se.

## 3. Zaključak

Tržište RSVP čitača postoji, ali je **gusto, posebno na iOS-u**. PDF podrška i privatnost sami po sebi **nisu** dovoljna diferencijacija. Moguća diferencijacija je u tri stvari, i nijedna nije dokazana:
1. kvalitet obrade PDF knjiga (H4);
2. Android i desktop iz istog koda (H5);
3. kombinacija 1 i 2 sa radom bez naloga.

Preporuka: **ne investirati u iOS omotač pre potvrde H4 i H5** (PWA + Google Play su jeftiniji kanali), i odlučiti o EPUB-u pre faze 4.

## 4. Šta je potrebno za zatvaranje PRD-03

1. **Uporedni test (H4):** iste 3 PDF knjige (roman, stručna knjiga sa slikama, knjiga sa zaglavljima) u ovoj aplikaciji, Strobe-u i Outread-u. Beleži prikazana zaglavlja i brojeve strana, rastavljene reči i položaj slika.
2. **Android pregled (H5):** 30 minuta pretrage Google Play-a za RSVP + PDF; tabela kao u §2.
3. **5–10 razgovora** sa ljudima koji čitaju PDF knjige: kako danas čitaju, šta bi platili, PDF ili EPUB.
4. Upis rezultata u ovaj fajl i status u `CONTROLS.md`.

## Izvori

- [Outread (App Store)](https://apps.apple.com/app/id778846279)
- [Strobe – Rapid Serial Reader (App Store)](https://apps.apple.com/us/app/strobe-rapid-serial-reader/id6759187873)
- [Speed Reader: RSVP Reader (App Store)](https://apps.apple.com/app/id6757968737)
- [Devour (App Store)](https://apps.apple.com/app/devour/id6758223988)
