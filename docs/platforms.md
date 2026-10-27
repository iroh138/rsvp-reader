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
| Android (vlasnikov telefon), Chrome, incognito, test build 2026-10-25 | vlasnik | **Prošlo uz jedan nalaz.** `book.pdf` i `images.pdf`: sve provere PASS/INFO. `jpx.pdf`: provera slike je jednom pala („Reading did not stop at the image“), a pri ponovnom pokretanju prošla. Tap → „Read from here“ radi. Offline (avionski režim) radi. Nalaz: čitanje se nije zaustavljalo pri skrolovanju (ispravljeno, PR „reader pauses when scrolled away“). Verzije Androida i Chrome-a nisu zabeležene |
| iPhone, iOS 18, Safari | vlasnik / tester | Nije testirano |
| Windows ili macOS, Chrome / Edge / Firefox | vlasnik | Nije testirano na verziji sa pdf.js 6 |

**Produkcija:** Cloudflare Pages, projekat `read` (adresa `https://read.pages.dev/` ili sa sufiksom, vidi ADR 0003). Pokreće se ručno: Actions → „Deploy production (Cloudflare Pages)“. Sopstveni origin, pa incognito nije potreban.

**Test build za uređaje:** https://iroh138.github.io/rsvp-reader/ (workflow „Pages test deploy“, pokreće se ručno iz `main`). Ovo nije produkcioni hosting: deli origin sa ostalim Pages sajtovima vlasnika (ADR 0003). Koristi samo testne PDF-ove, koje preuzimaš sa GitHub-a: `tests/fixtures/` → fajl → *Download raw file*.

> **Otvaraj test build samo u incognito tabu** (ili u pregledaču u kom ne koristiš staru aplikaciju). Stara verzija radi na `https://iroh138.github.io/speed-reading-app/`, a to je **isti origin**. U istom profilu pregledača test build bi otvorio tvoju stvarnu biblioteku (ista IndexedDB baza `rsvp-reader`). Novi service worker bi pri aktivaciji obrisao keš stare aplikacije, pa ona više ne bi radila offline. Incognito ima odvojeno skladište. Instalacija PWA-a se tamo ne može testirati, ali offline rad može (avionski režim, pa reload).

**Ručni test po uređaju (oko 10 minuta).** Upiši rezultat u ovu tabelu:
1. Otvori aplikaciju sa `?dev`.
2. Uvezi `tests/fixtures/book.pdf` i `jpx.pdf`.
3. Pokreni „Run all checks“. Sve treba da bude PASS ili INFO.
4. Tapni reč na stranici, pa „Read from here“.
5. Čitaj do slike u `jpx.pdf`: slika mora biti vidljiva.
6. Instaliraj aplikaciju, isključi mrežu, otvori je ponovo i uvezi `book.pdf`.
7. **Velike knjige (performanse, PLAN §3):** uvezi `tests/fixtures/perf/long-300.pdf`, pa `long-1000.pdf`. Upiši vreme koje biblioteka prikaže ispod naslova („imported in … s“). Cilj je ≤30 s za 300 strana, a 1000 strana mora da se uveze bez pada taba. Zatim zatvori aplikaciju, otvori je ponovo i proveri da se knjiga od 1000 strana otvori za oko 2 s.

## Performanse (PLAN §3) — merenje 2026-10-27

`tests/e2e/perf.py`, headless Chromium sa procesorom usporenim 4× kao zamena za srednji telefon. **Ovo je približna vrednost, a ne merenje na uređaju.** Merenje na uređaju je korak 7 iznad.

| Merenje | Cilj | Rezultat |
|---|---|---|
| Uvoz 300 strana (115 hiljada reči) | ≤30 s | 15,2–15,6 s |
| Uvoz 1000 strana (383 hiljade reči) | bez pada | 63 s; najveća memorija glavne niti 50–66 MB |
| Pokretanje bez mreže, otvorena knjiga od 1000 strana | ≤2 s | 1,15 s |
| Prva strana u pregledu dokumenta | ≤2 s | 0,5–0,6 s |
| Čitanje 20 s | bez seckanja | najduži frejm 83 ms (usporeno 4×) |
| Pozicija se snima tokom čitanja | najmanje na 5 s | na 5,1–5,2 s |

Vreme uvoza raste linearno (≈40 ms po strani u svim delima knjige), pa nema skrivenog kvadratnog troška. Memorija worker-a (pdf.js) se ne meri, a ona je najveći rizik za pad taba na telefonu sa malo RAM-a.

## Otvoreno: povremeni pad provere slike na telefonu (2026-10-25)

Prvo pokretanje „Run all checks“ za `jpx.pdf` na telefonu je palo, a drugo je prošlo. U Chromium-u se pad nije mogao reprodukovati, ni pri CPU usporenju do 20x na mobilnom ekranu. Iz koda postoji više kandidata:
- pauza zbog gubitka fokusa prozora (`blur`, npr. sistemsko obaveštenje o preuzimanju);
- tajmer koji kasni više od 1 s, pa se tumači kao tab u pozadini;
- ponovno otvaranje knjige tokom provere.

Simulirani gubitak fokusa daje tačno taj simptom. Uzrok nije utvrđen. Provera sada ispisuje **zašto** čitanje nije stiglo do slike, npr. „Playback stopped 39 ms after the start: window lost focus“. Ako se ponovi, prepiši taj red.
