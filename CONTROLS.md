# CONTROLS.md — RSVP Speed Reader

| Polje | Vrednost |
|---|---|
| Projekat | RSVP Speed Reader (`iroh138/rsvp-reader`, kopija `iroh138/speed-reading-app` @ `29de07e`) |
| Scenario | **S1** (statička PWA, bez naloga i servera), sa uslovnim stavkama za naplatu. Prelazi u **S2** ako odluka o naplati uvede naloge, server, sinhronizaciju ili pretplatu. Tada ponovo pokrenuti `app-plan`. |
| Nivo zrelosti | Funkcionalni prototip (milestone 6/6 završen) → cilj: komercijalna produkcija |
| Tržišta / kanali | Globalno (uključujući EU i Srbiju) · Web/PWA · Google Play · Apple App Store |
| Odgovorna osoba | Vlasnik projekta (iroh138) |
| Datum | 2026-10-24 |

## Okidači

| Okidač | Važi | Osnov |
|---|---|---|
| Lični podaci | DA | IP adrese u logovima hostinga i prodavnica; trenutno i Google Fonts (`index.html:18-20`). Knjige i pozicije ostaju na uređaju. |
| Nalozi / admin uloge | NE | Odluka: bez naloga (local-first) |
| Organizacije / multi-tenant | NE | — |
| Naplata, krediti, kuponi, trial | **NEPOZNATO** | Model naplate nije odlučen. Stavke označene „uslovno“ postaju aktivne odlukom. |
| Ciljani korisnici u EU | DA | Globalno tržište |
| Rad za klijenta | NE | Sopstveni proizvod |
| Mobilna aplikacija u App Store / Google Play | DA | — |
| Instalirani softver / auto-update | DA | Service worker (`sw.js`), ažuriranja kroz prodavnice |
| CI/CD sa pristupom produkciji | DA (planirano) | Deploy i store build iz CI-ja (faza 3) |
| AI coding agenti | DA | Razvoj uz Claude |
| AI funkcionalnosti u proizvodu | NE | — |
| Korisnički sadržaj / maloletnici / regulisan sektor | NE | PDF-ovi ostaju lokalni i ne dele se; maloletnici nisu ciljna grupa (**potvrditi**) |
| Transakcioni email | NE | — |
| Kritični eksterni dobavljači | DA | Statički hosting, Apple, Google |

## Pravila gate-ova

- **B** blokira lansiranje. **R** se može odložiti samo uz procenjen, dokumentovan i prihvaćen rizik. **N/A** zahteva razlog. **odl.** je odloživo uz zapis odluke.
- Svaka B stavka mora imati dokaz vezan za testiranu verziju (commit + datum).
- Zakonska ili ugovorna obaveza ne može se zaobići prihvatanjem rizika.
- AI self-review nije dovoljan dokaz za B.
- **Uslovno**: stavka postaje aktivna kada se donese odluka o naplati. Do tada je otvorena nepoznanica, a ne N/A.

## Proizvod i arhitektura

| ID | Kontrola i provera | Gate | Dokaz | Skill | Vlasnik | Status / dokaz (commit, datum) |
|---|---|---|---|---|---|---|
| PRD-01 | Acceptance criteria za 5 kritičnih tokova (PLAN.md §2); UAT na Android, iOS i desktopu | B | UAT zapisnik po uređaju | app-product-architecture | Vlasnik | Delimično: AC napisani (`docs/phase-1/02-zahtevi.md`, 2026-10-24); UAT nedostaje |
| PRD-02 | MVP ispunjava obećanu vrednost: cele knjige iz tekstualnog PDF-a, offline, tačan tempo | B | UAT + 3 realne knjige različitog formata | app-product-architecture | Vlasnik | Nedostaje dokaz |
| ARH-01 | Integritet lokalnih podataka (IndexedDB): uvoz atomičan, prekid uvoza ne ostavlja polovične zapise, prekoračenje kvote obrađeno | B | Test prekida (zatvaranje taba tokom uvoza), test kvote | app-product-architecture | Vlasnik | Ispunjeno lokalno (grana `arh-01-integrity`, 2026-10-27). `tests/e2e/integrity.py`: (1) premala kvota (CDP): uvoz koji ne staje → poruka, 0 zapisa; manja knjiga i dalje staje; vraćanje kopije staje uz poruku i zadržava već vraćeno; (2) tab zatvoren u 13 trenutaka uvoza knjige od 150 strana (čitanje strana, „Saving…“, kraj) → posle ponovnog otvaranja biblioteka uvek dosledna, isti PDF se zatim uvozi normalno; (3) **pronađena i ispravljena greška:** drugi tab koji se otvori tokom uvoza brisao je strane tog uvoza kao „nedovršene“ (stari kod pada na testu). Ispravka: Web Locks brava po knjizi; dokument se upisuje samo ako su sve strane još tu (ta druga zaštita nema automatski test). Ostaje: provera na stvarnim uređajima (Safari bez Web Locks pre 15.4 nije podržan zbog pdf.js 6) |
| ARH-02 | Migracije `DB_VERSION` / `PROCESSOR_VERSION` na reprezentativnoj biblioteci: pozicije čitanja se ne pomeraju | B | Test: biblioteka iz stare verzije → nova verzija | app-product-architecture | Vlasnik | Delimično: migracioni okvir `src/storage.js` — browser test sa pravim IndexedDB-om: nadogradnja v1→v2 čuva podatke, neuspela migracija se potpuno vraća, otvoren stari tab ne blokira, rollback aplikacije otvara noviju bazu; stari kod pada u sva 3 scenarija; nadogradnja sa `main` builda čuva biblioteku i poziciju (grana `phase-4-db-migrations`, 2026-10-25). Ostaje: test na reprezentativnoj biblioteci (velike knjige) i na stvarnim uređajima |
| PRD-03 | Validacija potrebe pre veće investicije (iOS, naplata) | R | Beleška: konkurencija, 5–10 korisničkih razgovora ili test stranica | app-product-architecture | Vlasnik | Delimično: desk research (`docs/phase-1/01-validacija-potrebe.md`, 2026-10-24) — H2/H3 opovrgnute, H4/H5 neproverene; razgovori sa korisnicima nedostaju |
| ARH-03 | ADR beleške za rane odluke | odl. | `docs/adr/` | app-product-architecture | Vlasnik | Delimično: ADR 0001 (prihvaćeno), ADR 0002–0004 (predlog), 2026-10-24 |
| DEX-01 | Izvoz podataka: pozicije (kopiraj/nalepi) i rezervna kopija cele biblioteke | R | Test izvoz → uvoz na drugom uređaju | app-product-architecture | Vlasnik | Ispunjeno lokalno (grana `dex-01-library-backup`, 2026-10-27): „Back up library“ pravi ZIP (originalni PDF-ovi + `library.json` sa pozicijama i podešavanjima), čitljiv standardnim ZIP alatima; „Restore library“ svaki PDF ponovo uvozi kroz običan uvoz (obrađeni podaci se ne uzimaju iz fajla), ne briše ništa, novija pozicija na uređaju ostaje. Dokaz: `tests/backup.test.mjs` (7, uklj. odbijanje putanja `../`, duplikata, kompresovanih i neusklađenih zapisa), `tests/e2e/backup.py` (uređaj A → B: iste knjige, isti tekst po stranici, ista pozicija i podešavanja; dvostruko vraćanje ne dodaje ništa; oštećen fajl odbijen). Ostaje: provera na Androidu i iOS-u (preuzimanje fajla) |

## Bezbednost

| ID | Kontrola i provera | Gate | Dokaz | Skill | Vlasnik | Status / dokaz (commit, datum) |
|---|---|---|---|---|---|---|
| SEC-03 | Nepouzdani ulazi: PDF (`isEvalSupported:false` na svim `getDocument`, limit veličine, korpus oštećenih/zlonamernih PDF-ova) i uvoz pozicija (validacija tipa i opsega; poznat bag `index.html:1762, 1782`) | B | Testovi sa negativnim slučajevima | app-security | Vlasnik | Delimično: uvoz pozicija validiran (PR #5); PDF korpus sa 5 neispravnih fajlova (lozinka, skeniran, nije PDF, prekinut, nasumični bajtovi) — jasna poruka, ništa sačuvano, bez grešaka; statički test `isEvalSupported: false` na svim pozivima (grana `phase-4-pdf-corpus`, 2026-10-25). Ostaje: limit broja stranica, ogromne slike (DoS) |
| SEC-04 | Produkciona konfiguracija: HTTPS, CSP (header ili meta), bez spoljnih resursa, bez izloženih fajlova, build bez debug panela | B | Provera headera na prod URL-u + pregled builda | app-security | Vlasnik | Delimično (grana `hosting-cloudflare`, 2026-10-27): `hosting/_headers` — CSP bez `unsafe-inline`/`unsafe-eval` i bez drugih origin-a, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, X-Frame-Options; unit test `tests/headers.test.mjs`; browser `tests/e2e/csp.py`: 0 kršenja, ubačena inline skripta blokirana; svi ostali browser testovi prolaze pod istim headerima. `scripts/verify-deploy.mjs` proverava živi sajt posle deploy-a. Ostaje: dokaz sa produkcionog URL-a (prvi deploy) i odluka o `?dev` panelu u produkciji |
| SEC-06 | SCA zavisnosti; pdf.js 3.11.174 je zastareo (CVE-2024-4367 ublažen kroz `isEvalSupported:false`) | R | SCA izveštaj + plan nadogradnje | app-security | Vlasnik | Delimično: pdf.js 6.4.299 (legacy) umesto 3.11.174 — korpus 9/9 identičan, nadogradnja biblioteke testirana, statički test verzije ≥ 4.2.67 i odsustva eval putanje; ADR 0005 prihvaćen (2026-10-25); 0 npm zavisnosti. Ostaje: nedeljni SCA za vendor fajlove |
| SEC-07 | Threat model: PDF parser, lanac isporuke (hosting, SW, store build), uvoz pozicija | R | `docs/threat-model.md` | app-security | Vlasnik | Nacrt (P1–P5), čeka ljudski pregled; 2026-10-24 |

## Privatnost i pravo (stavke označene † zahtevaju stručnu proveru)

| ID | Kontrola i provera | Gate | Dokaz | Skill | Vlasnik | Status / dokaz (commit, datum) |
|---|---|---|---|---|---|---|
| PRV-01† | Data inventory, privacy notice, pravni osnov; Apple privacy label i Google Play Data safety usklađeni sa stvarnim ponašanjem | B | Privacy notice URL + popunjeni obrasci prodavnica | app-privacy-legal | Vlasnik | Nedostaje dokaz |
| PRV-02† | DPA sa hosting provajderom (obrađuje IP adrese) | R | Prihvaćen DPA | app-privacy-legal | Vlasnik | Nedostaje dokaz |
| PRV-04† | Prenosi van EEA: Google Fonts (SAD) pri svakom učitavanju; lokacija hostinga | B | 0 zahteva van sopstvenog origin-a (mrežni log, čist profil) ili dokumentovan osnov prenosa | app-privacy-legal | Vlasnik | Delimično: aplikacija više ne šalje zahteve van origin-a — fontovi i pdf.js lokalno, CDN kod uklonjen; unit test `tests/no-external-requests.test.mjs` (pada na starom kodu), browser: 0 spoljnih zahteva, nadogradnja sa stare verzije: 0 posle preuzimanja (grana `phase-4-local-fonts`, 2026-10-25). Stari slučaj „prva poseta posle deploy-a služi staru verziju sa Google Fonts“ ne važi za produkciju: `read.pages.dev` je nov origin bez starih korisnika. Hosting (2026-10-27): Cloudflare (SAD, globalni edge) — osnov prenosa: EU-US DPF (DPA čl. 6.4), inače SCC; stručna potvrda ostaje |
| PRV-08† | Predstavnik u EU (GDPR čl. 27) ili dokumentovan izuzetak čl. 27(2) | B | Pravna beleška | app-privacy-legal | Vlasnik | Nedostaje dokaz |
| LEG-01† | Distribucija i prodaja dozvoljene: Apple/Google developer nalozi za srpsko lice; trader status prema EU DSA u obe prodavnice; Google Play merchant podrška za Srbiju; **patentni rizik RSVP/ORP prikaza (crveno pivot slovo)** | B | Aktivni nalozi + pravna beleška o patentima | app-privacy-legal | Vlasnik | Nedostaje dokaz. Nalazi: Google Play merchant podržava Srbiju; Apple isplata nepotvrđena; EP2872984B1 identifikovan, status po zemljama neproveren (`docs/phase-1/03-memo-naplata.md`) |
| LEG-02† | Poreski model sproveden (MoR ili sopstveni PDV/OSS) — **uslovno** | B | Odluka + mišljenje knjigovođe | app-privacy-legal | Vlasnik | Uslovno |
| LEG-03† | EAA (EU Accessibility Act): da li je aplikacija „softver namenjen e-knjigama“ i važi li izuzetak za mikropreduzeća | B | Pravna beleška; ako važi, WCAG 2.2 AA dokaz | app-privacy-legal | Vlasnik | Nedostaje dokaz |
| LEG-04 | Licence: `LICENSE` za sopstveni kod, Apache-2.0 tekst za pdf.js, OFL za fontove | R | Fajlovi licenci u repou i u buildovima | app-privacy-legal | Vlasnik | Delimično: `LICENSE` (AGPL-3.0-only), `THIRD_PARTY_NOTICES.md`, Apache-2.0 za pdf.js, OFL za fontove u `vendor/fonts/` (grana `phase-4-local-fonts`, 2026-10-25) |
| CRA-01† | CRA: proces prijave aktivno iskorišćenih ranjivosti (24 h / 72 h) za aplikacije u prodavnicama na EU tržištu; kontakt za prijavu ranjivosti | B | Proces + `SECURITY.md` | app-privacy-legal | Vlasnik | Delimično: `SECURITY.md` + private vulnerability reporting uključen (2026-10-25); proces 24 h/72 h nedostaje |

## Distribucija i naplata

| ID | Kontrola i provera | Gate | Dokaz | Skill | Vlasnik | Status / dokaz (commit, datum) |
|---|---|---|---|---|---|---|
| DST-01 | Zahtevi prodavnica: Apple guideline 4.2 (minimalna funkcionalnost web omotača), age rating, support URL, privacy label; Google Play target API, Data safety, Digital Asset Links za TWA | B | Odobren review u obe prodavnice | app-billing-distribution | Vlasnik | Nedostaje dokaz |
| DST-02 | Signing i integritet ažuriranja: Play App Signing, Apple sertifikati van repoa; PWA se objavljuje samo iz CI-ja; SW verzija generisana u buildu | B | Opis ključeva + CI log objave | app-billing-distribution | Vlasnik | Delimično: `sw.js` generisan u buildu sa hash verzijom (`phase-3-foundation`, 2026-10-24); deploy samo iz CI-ja (`.github/workflows/deploy.yml`, ručno iz `main`, okruženje `production`) pripremljen 2026-10-27 — ostaje CI log prvog deploy-a; signing za prodavnice nedostaje |
| BIL-01 | Pristup plaćenim funkcijama ne zavisi samo od klijentskog signala (StoreKit/Play Billing verifikacija) — **uslovno** | B | Negativni testovi | app-billing-distribution | Vlasnik | Uslovno |
| BIL-02 | Webhook potpis, replay, idempotency — **uslovno, samo ako postoji server** | B | Testovi | app-billing-distribution | Vlasnik | Uslovno |
| BIL-03 | Refund, otkaz, neuspela naplata — **uslovno** | B | Opis toka + test | app-billing-distribution | Vlasnik | Uslovno |
| FRD-01 | Zloupotreba naplate (deljenje licence, trial) — **uslovno** | R | Beleška o pretnjama | app-security | Vlasnik | Uslovno |

## Isporuka, kvalitet i operacije

| ID | Kontrola i provera | Gate | Dokaz | Skill | Vlasnik | Status / dokaz (commit, datum) |
|---|---|---|---|---|---|---|
| INF-01 | Release iz označene verzije (git tag → PWA + store build) | R | Tag + CI log | app-delivery-ops | Vlasnik | Nedostaje dokaz |
| INF-02 | CI/CD zaštićen: `uses:` pinovan na SHA, minimalni `permissions`, bez `pull_request_target` sa kodom iz fork-a, tajne samo u zaštićenom okruženju | B | Pregled workflow-a | app-delivery-ops | Vlasnik | Ispunjeno za CI: PR #1 i push na `main` @ `62beb54` zeleni (test-and-build, secret-scan, workflow-policy), sve akcije na SHA, `contents: read`, bez fork triggera; deploy job još ne postoji (2026-10-25). Deploy workflow (2026-10-27): akcije na SHA, `contents: read`, ručno samo iz `main`, tajna u okruženju `production` samo za Wrangler korake, Wrangler iz lockfile-a sa integritetom i bez install skripti |
| INF-04 | Rollback: vraćanje prethodne PWA verzije i ispravan prelaz service workera | R | Proba rollback-a | app-delivery-ops | Vlasnik | Delimično: rollback aplikacije posle promene šeme ne gubi pristup biblioteci (browser test `tests/e2e/storage.py`, 2026-10-25); proba rollback-a deploy-a čeka hosting |
| QA-01 | Kritični funkcionalni i regresioni testovi (tokenizer, pivot, tempo, cleanup, migracije) | B | CI test log | app-delivery-ops | Vlasnik | Delimično: 40 unit testova u CI-ju; browser: smoke, PDF korpus (8 fajlova) prema golden-u, offline, fontovi, pozicije, migracije, nadogradnja (grana `phase-4-pdf-corpus`, 2026-10-25); browser testovi se još ne pokreću u CI-ju. N1 i N2 ispravljeni (2026-10-25); otvoren N3 (`docs/pdf-corpus.md`) |
| QA-02 | Automatizovani E2E (uvoz → čitanje → nastavak) | odl. | — | app-delivery-ops | Vlasnik | — |
| QA-03 | Pristupačnost, interni cilj WCAG 2.2 AA; poznat neuspeh kontrasta (`#4a4a4d` na `#000`) | R | Izveštaj | app-ux-accessibility | Vlasnik | Neuspešno (kontrast) |
| QA-04 | Provera podržanih platformi: lista verzija (Android Chrome, iOS Safari/omotač, desktop) i test na svakoj | B | Matrica testova | app-delivery-ops | Vlasnik | Delimično: matrica i ručni test u `docs/platforms.md`; headless Chromium prolazi; **vlasnikov Android telefon (Chrome, incognito): prošlo**, uz jedan nereprodukovan pad provere slike (dodata dijagnostika) i nalaz o skrolovanju (ispravljen) (2026-10-25). Nedostaje: verzije uređaja, Android 10, iOS 18, desktop |
| QA-05 | Unit testovi poslovnih pravila (CORE, `index.html:306-759`) | R | CI test log | app-delivery-ops | Vlasnik | Delimično: unit testovi CORE pravila prema `docs/phase-1/02-zahtevi.md` (`phase-3-foundation`, 2026-10-24) |
| UX-01 | Test upotrebljivosti kritičnih tokova | odl. | — | app-ux-accessibility | Vlasnik | — |
| UX-02 | Četiri stanja ekrana: biblioteka, uvoz, čitač, prikaz dokumenta | R | Pregled ekrana | app-ux-accessibility | Vlasnik | Nedostaje dokaz |
| OPS-02 | Incident response tabletop (kompromitovan deploy, ranjivost u pdf.js) | R | Zapisnik | app-delivery-ops | Vlasnik | Nedostaje dokaz |
| OPS-03 | Korisnička podrška: kontakt, rok odgovora | R | Support stranica | app-delivery-ops | Vlasnik | Nedostaje dokaz |
| TPC-01 | Kontinuitet dobavljača: alternativni hosting, rezerva naloga i ključeva prodavnica | R | Beleška | app-delivery-ops | Vlasnik | Delimično (2026-10-27): build je statički i nezavisan od hostinga; zamena = prevod `hosting/_headers` + deploy korak (ADR 0003). Rezerva: GitHub Pages test build. Ostaje: rezerva naloga i ključeva prodavnica |
| AI-01 | AI agent bez prod tajni i signing ključeva; novi paketi uz odobrenje | B | Pravila rada + konfiguracija | app-ai-dev-safety | Vlasnik | Delimično: ruleset `protect-main` bez bypass-a — direktan push agenta na `main` odbijen (2026-10-25); Cloudflare token samo u GitHub okruženju `production`, agent ga nema i ne pokreće deploy (2026-10-27); Play signing čeka nalog |
| AI-02 | Nove zavisnosti proverene pre uvođenja | B | Zapis provere | app-ai-dev-safety | Vlasnik | Delimično: `.npmrc` ignore-scripts; Vitest i `pdfjs-dist` iz npm-a odbijeni zbog tranzitivnih/nativnih zavisnosti (ADR 0004 dopuna) (`phase-3-foundation`, 2026-10-24) |
| AI-03 | Ljudski pregled P0 izmena (uvoz PDF-a, SW, uvoz pozicija, naplata) + negativan test | B | PR pregled | app-ai-dev-safety | Vlasnik | Nedostaje dokaz |
| GOV-01 | Preostali rizici sa vlasnikom; go/no-go odluka | B | `app-launch-check` izveštaj | app-launch-check | Vlasnik | Nedostaje dokaz |
| GOV-02 | Sve izmene kroz Git (izvorni repo ima jedan „upload“ commit) | B | Git istorija | app-delivery-ops | Vlasnik | Ispunjeno: `main` zaštićen rulesetom `protect-main` (PR obavezan, brisanje i force push blokirani); direktan push odbijen u testu (2026-10-25, `main` @ `62beb54`) |
| GOV-03 | Code review svih izmena (solo: pregled AI diff-a pre merge-a) | R | PR istorija | app-delivery-ops | Vlasnik | Delimično: PR #1 pregledao i spojio vlasnik (2026-10-25); pravilo važi za sve buduće izmene |

## Neprimenljive stavke

| ID | Razlog |
|---|---|
| SEC-01, SEC-02, SEC-08 | Nema naloga, zaštićenih serverskih resursa ni admin akcija |
| SEC-05 | S1 statički sajt; preview okruženje je preporuka, ne gate |
| PRV-03 | Nema analitike ni praćenja (nakon uklanjanja Google Fonts). Postaje B čim se doda analitika. |
| PRV-05 | Ne radi se za klijenta |
| PRV-06, PRV-07 | Operator ne čuva podatke korisnika i nema sopstvene logove |
| INF-03 | Operator nema neobnovljive podatke; rizik gubitka podataka na uređaju pokrivaju ARH-01 i DEX-01 |
| INF-05 | Nema merenih usluga |
| INF-06, OPS-01, OPS-04, QA-06 | Nema dinamičke usluge ni hostovane infrastrukture osim statičkog hostinga |
| EML-01 | Nema transakcionog email-a |
| SAF-01 | Nema deljenja sadržaja; maloletnici nisu ciljani (**potvrditi**; age rating ide pod DST-01) |
| DEC-01 | S1; aplikacija radi offline i bez operatora |
| AIP-01 | Proizvod ne sadrži AI |

## Go / no-go

Go zahteva sledeće: sve B stavke Ispunjeno sa dokazom za release commit, sve R i N/A odluke validne, i uslovne stavke razrešene odlukom o naplati. Odluku donosi odgovorna osoba posle `app-launch-check`.

Odluka: ________ Datum: ________ Potpis: ________

## Izuzeci i prihvaćeni rizici

| ID | Razlog | Kompenzacione mere | Vlasnik | Rok | Odobrio |
|---|---|---|---|---|---|
| | | | | | |
