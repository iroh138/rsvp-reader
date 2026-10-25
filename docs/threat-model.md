# SEC-07 — Threat model

Datum: 2026-10-24 · Kod: `a44a0e2` · Scenario S1 · **Status: nacrt, čeka ljudski pregled** (AI-generisan dokument nije dokaz za B gate).
Pretpostavka iz faze 1: naplata = opcija A (bez naplate). Ako se izabere B/C/D, dodati odeljak P6 i FRD-01.

Sredstva (zajednička za sve tokove):
- **S-a** — PDF fajlovi korisnika (mogu biti privatni ili poverljivi);
- **S-b** — biblioteka (tokenizovane stranice, pozicije, podešavanja);
- **S-c** — integritet koda koji se izvršava kod korisnika;
- **S-d** — signing ključevi i nalozi prodavnica;
- **S-e** — poverenje u poruku „sve ostaje na uređaju“.

## P1 — Uvoz i prikaz PDF-a

- **Akteri:** autor zlonamernog PDF-a; korisnik koji ga nesvesno otvori.
- **Granica poverenja:** bajtovi fajla → pdf.js parser (worker) → tekst, operatori i canvas → DOM.
- **Napadi:**
  - **A1:** izvršavanje JS-a kroz font (CVE-2024-4367, pdf.js ≤4.1.392). Kontrola postoji: `isEvalSupported:false` (`index.html:1265, 1308, 1421`).
  - **A2:** nova ranjivost parsera u zastareloj verziji 3.11.174.
  - **A3:** DoS — ogroman broj stranica, ogromne slike, kompresione bombe → pad taba ili zauzeće kvote.
  - **A4:** XSS kroz metapodatke (Title) ili tekst. Kontrola postoji: svuda `textContent`, nema `innerHTML` (potvrđeno grep-om). Tekstualni sloj renderuje pdf.js `renderTextLayer` (`index.html:1460`).
- **Posledice:** A1/A2 → izvršavanje koda na origin-u znači čitanje cele biblioteke (S-a, S-b). Slanje podataka napolju danas ništa ne sprečava, jer CSP ne postoji. A3 → gubitak dostupnosti, polovičan uvoz.
- **Kontrole:**
  - zadržati `isEvalSupported:false` + test koji to proverava;
  - nadogradnja pdf.js na aktuelnu verziju (ADR 0004);
  - **CSP sa `connect-src 'self'` i bez `unsafe-eval`**, da kompromitovan kod ne može da pošalje podatke napolje;
  - limit 200 MB (postoji);
  - limit broja stranica i obrada u workeru;
  - korpus oštećenih i zlonamernih PDF-ova u testovima (SEC-03).
- **Preostali rizik:** 0-day u pdf.js. Ublažava ga CSP; prihvata se uz praćenje izdanja (faza 9).

## P2 — Uvoz pozicija i podešavanja (JSON iz clipboarda)

- **Akteri:** korisnik koji nalepi tekst iz nepouzdanog izvora (forum, „preset“).
- **Granica poverenja:** tekst → `JSON.parse` → IndexedDB (`progress`) i localStorage (`rsvp-settings`).
- **Napadi:**
  - **A5:** neispravne vrednosti `wpm`/`sent` (string, negativno, NaN). **Potvrđeno** (ispravka 2026-10-25, reprodukovano u browseru):
    - string `wpm` trajno kvari čitač („NaN wpm“, ne napreduje, preživljava reload);
    - ogroman `sent` zaglavi čitač na kraju rečenice;
    - negativan `wpm` odmah pauzira čitanje.
    Ranija tvrdnja da negativan `wpm` „pravi brzu petlju koja prepiše poziciju“ bila je netačna. Ispravljeno u `src/settings.js`.
  - **A6:** ogroman JSON (hiljade unosa) → sporo ili blokira UI.
  - **A7:** `tokenIndex` van opsega knjige.
- **Posledice:** gubitak pozicije, neupotrebljiv čitač do brisanja podešavanja (S-b). Nema izvršavanja koda, jer je `JSON.parse` bezbedan i vrednosti se ne interpretiraju kao kod.
- **Kontrole:**
  - šema: tipovi i opsezi (`wpm` 100–1000, `sent` 1,5–4, `tokenIndex` ceo broj ≥0, ograničen dužinom knjige pri otvaranju);
  - limit veličine teksta i broja unosa;
  - ista validacija i pri čitanju localStorage-a na startu (`index.html:1989`);
  - negativni testovi.
- **Stanje (2026-10-25):** kontrole su implementirane u `src/settings.js` (unit testovi `tests/settings.test.mjs`, browser `tests/e2e/positions.py`), uključujući popravku već oštećenog localStorage-a pri startu.
- **Preostali rizik:** nizak.

## P3 — Lanac isporuke (hosting, service worker, CI, prodavnice)

- **Akteri:** napadač sa pristupom GitHub nalogu ili CI tokenu; kompromitovana GitHub Action ili npm paket; kompromitovan hosting nalog; AI agent sa previše prava (AI-01).
- **Granice poverenja:** repo → CI → hosting → SW keš korisnika; repo → CI → signing → Play/App Store.
- **Napadi:**
  - **A8:** zlonamerni commit ili zamenjen `vendor/pdf.min.js`. Danas se vendor fajlovi ubacuju ručno („Add files via upload“), bez provere porekla.
  - **A9:** kompromitovana Action preko taga (videti CVE-2026-33634 u `app-security`).
  - **A10:** zlonamerni SW se **trajno** zadržava kod korisnika (cache-first, `skipWaiting`). Jedan loš deploy kontroliše sve buduće posete dok se ne zameni.
  - **A11:** krađa upload ključa ili Apple sertifikata → lažno ažuriranje u prodavnici.
- **Posledice:** potpuna kompromitacija S-a, S-b, S-c kod svih korisnika; gubitak S-e.
- **Kontrole:**
  - 2FA na GitHub-u i hostingu;
  - zaštićena `main` grana;
  - deploy samo iz CI-ja sa taga (DST-02, INF-01);
  - Actions pinovane na SHA, `permissions: contents: read` osim deploy koraka (INF-02);
  - pdf.js iz npm-a sa lockfile-om i proverom integriteta umesto ručnog upload-a (ADR 0004);
  - Play App Signing (upload ključ odvojen od signing ključa); ključevi van repoa i van dometa AI agenta;
  - SW plan oporavka: „kill-switch“ verzija SW-a koja briše keš, i dokumentovan postupak (INF-04, OPS-02);
  - CSP (ograničava i štetu od A8).
- **Preostali rizik:** srednji dok CI i signing ne postoje; nizak posle faze 3.

## P4 — Lokalni podaci i origin

- **Akteri:** drugi kod na **istom origin-u**; osoba sa fizičkim pristupom otključanom uređaju; ekstenzije pregledača.
- **Granica poverenja:** origin aplikacije. IndexedDB, Cache Storage i localStorage dele svi skriptovi istog origin-a, bez obzira na putanju.
- **Napadi:**
  - **A12 (zavisi od hostinga, verovatno relevantno):** ako je aplikacija na `iroh138.github.io/<repo>`, svaki drugi tvoj GitHub Pages projekat na `iroh138.github.io` je isti origin. Kompromitovan ili neoprezan drugi projekat može da čita celu biblioteku i da registruje SW sa šire putanje.
  - **A13:** fizički pristup uređaju → knjige su čitljive. Van opsega: zaštita je zaključavanje uređaja; aplikacija ne šifruje podatke.
  - **A14:** iOS Safari briše skladište neinstaliranih sajtova posle perioda neaktivnosti → gubitak biblioteke (dostupnost, ne poverljivost).
- **Kontrole:**
  - **sopstveni origin samo za ovu aplikaciju** (ADR 0003);
  - `navigator.storage.persist()` (postoji);
  - upozorenje i ponuda instalacije na iOS-u (T4.4);
  - izvoz (DEX-01).
- **Preostali rizik:** A13 prihvaćen i naveden u privacy notice-u.

## P5 — Razvoj uz AI agente

- **Napadi:**
  - **A15:** agent uvede nepostojeći ili zlonamerni paket (slopsquatting);
  - **A16:** agent dobije pristup tajnama ili prod deploy-u;
  - **A17:** nepregledana izmena u P1–P3.
- **Kontrole:** AI-01..03 (odobrenje paketa, bez tajni u radnom okruženju agenta, ljudski pregled diff-a za P0 oblasti: uvoz PDF-a, SW i deploy, uvoz pozicija, naplata).

## Uticaj na arhitekturu (ulaz za fazu 3–4)

1. CSP je glavna kontrola za P1 i P3. Da bi bila stroga (bez `unsafe-inline`), inline `<script>` i `<style>` moraju u fajlove (ADR 0004).
2. `frame-ancestors` i HSTS zahtevaju HTTP headere. Meta CSP ne podržava `frame-ancestors`, a GitHub Pages ne dozvoljava sopstvene headere (ADR 0003).
3. Sopstveni origin je preduslov za razdvajanje podataka (A12).
