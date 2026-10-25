# QA-04 — Podržane platforme i matrica testiranja

Odluka vlasnika (2026-10-25, ADR 0005): pdf.js 6 legacy build. Zahtev vlasnika: **mora da radi na Androidu 10**.

## Podržano

| Platforma | Minimum | Osnov |
|---|---|---|
| Android | **Android 10+** sa ažuriranim Chrome-om (125+) | Chrome za Android traži Android 10+ od verzije 139 (avgust 2025), pa Android 10 dobija aktuelan Chrome. Provereno 2026-10-25; proveriti ponovo na dan lansiranja. |
| iPhone / iPad | iOS / iPadOS 18+ (Safari) | pdf.js FAQ: legacy build „mostly“ za Safari 18+ |
| Desktop | Chrome / Edge 125+, aktuelni Firefox, Safari 18+ | pdf.js FAQ |

Na starijem pregledaču aplikacija se otvara, a čitanje već uvezenih knjiga radi. Uvoz i prikaz PDF stranica prikazuju poruku da pregledač treba ažurirati (`tests/e2e/old-browser.py`).

**Rizici:**
- Android 10 uređaji **bez Google Play-a** (npr. noviji Huawei) ne dobijaju ažuriran Chrome.
- Drugi pregledači na Androidu (Samsung Internet, Firefox) imaju svoje verzije i nisu u matrici.
- Ako Chrome jednog dana ukine Android 10, Android 10 uređaji ostaju na poslednjoj verziji koja ga podržava. Ta verzija će i dalje biti iznad 125, pa aplikacija nastavlja da radi, ali bez bezbednosnih ispravki pregledača.

## Matrica testiranja

| Uređaj / pregledač | Ko | Stanje |
|---|---|---|
| Headless Chromium (Playwright), desktop | CI / agent | Prolazi: unit testovi, PDF korpus 9/9, smoke, offline, fontovi, pozicije, migracije, nadogradnja, stari pregledač (2026-10-25) |
| **Android 10, Chrome (ažuriran)** | vlasnik | Nije testirano |
| Android (tvoj telefon), Chrome | vlasnik | Nije testirano na verziji sa pdf.js 6 |
| iPhone, iOS 18, Safari | vlasnik / tester | Nije testirano |
| Windows ili macOS, Chrome / Edge / Firefox | vlasnik | Nije testirano na verziji sa pdf.js 6 |

**Test build za uređaje:** https://iroh138.github.io/rsvp-reader/ (workflow „Pages test deploy“, pokreće se ručno iz `main`). Ovo nije produkcioni hosting: deli origin sa ostalim Pages sajtovima vlasnika (ADR 0003). Koristi samo testne PDF-ove, koje preuzimaš sa GitHub-a: `tests/fixtures/` → fajl → *Download raw file*.

> **Otvaraj test build samo u incognito tabu** (ili u pregledaču u kom ne koristiš staru aplikaciju). Stara verzija radi na `https://iroh138.github.io/speed-reading-app/`, a to je **isti origin**. U istom profilu pregledača test build bi otvorio tvoju stvarnu biblioteku (ista IndexedDB baza `rsvp-reader`). Novi service worker bi pri aktivaciji obrisao keš stare aplikacije, pa ona više ne bi radila offline. Incognito ima odvojeno skladište. Instalacija PWA-a se tamo ne može testirati, ali offline rad može (avionski režim, pa reload).

**Ručni test po uređaju (oko 10 minuta).** Upiši rezultat u ovu tabelu:
1. Otvori aplikaciju sa `?dev`.
2. Uvezi `tests/fixtures/book.pdf` i `jpx.pdf`.
3. Pokreni „Run all checks“. Sve treba da bude PASS ili INFO.
4. Tapni reč na stranici, pa „Read from here“.
5. Čitaj do slike u `jpx.pdf`: slika mora biti vidljiva.
6. Instaliraj aplikaciju, isključi mrežu, otvori je ponovo i uvezi `book.pdf`.
