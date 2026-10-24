# ADR 0004 — Podela koda u ES module i minimalan build

- Status: Predloženo (2026-10-24)
- Kontekst:
  - Ceo kod je u jednom `index.html` sa inline JS i CSS-om. Stroga CSP (bez `unsafe-inline`) to ne dozvoljava.
  - Čiste funkcije nisu testabilne bez DOM-a.
  - pdf.js 3.11.174 je zastareo i ručno ubačen.
  - Najnovija verzija je `pdfjs-dist` 6.4.299 (npm, 2026-10-24), sa ulazom `build/pdf.mjs`, dakle ES modul. Skok sa 3.x na 6.x je veliki i API se menjao, pa je nadogradnja zaseban zadatak.
  - SW verzija i lista fajlova se održavaju ručno.
- Odluka (predlog):
  - Kod se deli na ES module (`core.js`, `player.js`, `storage.js`, `pdf-adapter.js`, `app.js`) i `styles.css`, bez UI frameworka.
  - `package.json` + lockfile: `pdfjs-dist` iz npm-a, test runner (npr. Vitest) i fake-indexeddb kao dev zavisnosti.
  - Build skripta kopira pdf.js iz `node_modules` u `dist/vendor`, generiše `sw.js` (lista fajlova + hash sadržaja) i izbacuje debug panele iz produkcionog builda.
  - Bundler se uvodi samo ako se pokaže potreba.
- Razlog: Najmanja promena koja omogućava CSP, unit testove, SCA nad lockfile-om (SEC-06) i ponovljiv build (INF-01, DST-02).
- Posledice:
  - Refaktor nosi rizik regresije. Zato se prvo pišu testovi nad postojećim CORE ponašanjem: CORE kod se izdvaja doslovno, testovi se pišu nad njim, i tek onda se menja.
  - Nadogradnja pdf.js na novi glavni release je zasebna promena sa korpusom PDF-ova (P0, AI-03).
