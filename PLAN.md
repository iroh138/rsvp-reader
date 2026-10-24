# PLAN.md — RSVP Speed Reader (komercijalizacija)

Scenario S1 (vidi `CONTROLS.md`) · polazno stanje: funkcionalni prototip, kopija `speed-reading-app` @ `29de07e` · 2026-10-24

## 1. Problem, korisnici, vrednost

Ljudi koji čitaju cele knjige i stručne PDF-ove žele da čitaju brže na telefonu i računaru, bez naloga, oblaka i slanja svojih fajlova bilo kome. Aplikacija prikazuje jednu po jednu reč (RSVP) sa istaknutim pivot slovom, prirodnim pauzama, čišćenjem zaglavlja i prikazom slika, i radi offline. Korisnici su B2C, globalno. **Diferencijacija** su cele knjige iz PDF-a + rad samo na uređaju; tu tezu tek treba proveriti (PRD-03).

## 2. Kritični tokovi i acceptance criteria

| # | Tok | Ulaz → očekivano | Neuspešni slučajevi |
|---|---|---|---|
| T1 | Uvoz PDF-a | Tekstualni PDF ≤200 MB → knjiga u biblioteci sa brojem stranica i reči; isti fajl drugi put → otvara postojeću | Skeniran, zaštićen lozinkom, oštećen, nije PDF, kvota puna, prekid uvoza → jasna poruka, ništa polovično sačuvano |
| T2 | Izbor početka | Tap na reč u prikazu stranice → čitanje kreće tačno od te reči | Stranica bez teksta, slika na stranici |
| T3 | RSVP čitanje | Tempo 100–1000 wpm, odstupanje ≤2 % na 120 reči pri 600 wpm; pauze na kraju rečenice i pasusa; zaglavlja preskočena; slika pauzira čitanje | Tab u pozadini → pauza bez skoka; neispravno uvezena podešavanja → odbijena |
| T4 | Nastavak | Zatvaranje aplikacije ili ažuriranje → nastavak na poslednjoj rečenici (gubitak ≤5 s čitanja) | Migracija verzije, iOS brisanje skladišta, nova instalacija |
| T5 | Instalacija, offline, ažuriranje | Instalacija iz browsera, Play-a i App Store-a; rad bez mreže; nova verzija se primenjuje bez gubitka podataka | Ažuriranje usred čitanja, rollback |

## 3. Merljivi NFR

- **Privatnost:** 0 mrežnih zahteva van sopstvenog origin-a (provera mrežnim logom u čistom profilu).
- **Bezbednost:** CSP bez `unsafe-eval`; pdf.js aktuelan i sa `isEvalSupported:false`; PDF se parsira samo u workeru.
- **Performanse (ciljevi za potvrdu na srednjem Android uređaju):** uvoz knjige od 300 strana ≤30 s; knjiga od 1000 strana se uvozi bez pada taba; prvo prikazivanje ≤2 s iz keša.
- **Dostupnost:** 100 % funkcija offline posle prve instalacije.
- **Podaci:** RPO/RTO za operatora N/A (nema serverskih podataka). Na uređaju: pozicija se snima najmanje svakih 5 s i pri `pagehide`.
- **Pristupačnost:** interni cilj WCAG 2.2 AA (kontrast, fokus, tastatura, čitači ekrana za UI van RSVP prozora).

## 4. Arhitektura

Jedan statički kod (HTML/JS, pdf.js u Web Workeru, service worker) koji se isporučuje u tri kanala: (a) PWA na statičkom hostingu, (b) Google Play kao TWA omotač, (c) iOS kao nativni omotač (npr. Capacitor/WKWebView). Podaci su lokalni: IndexedDB (`files`, `documents`, `pages`, `progress`) i localStorage (podešavanja).

**Granice poverenja:** (1) PDF fajl je nepouzdan → pdf.js worker; (2) uvezeni JSON pozicija je nepouzdan; (3) lanac isporuke: CI → hosting/SW → korisnik i CI → signing → prodavnice; (4) naplata, ako se uvede: verifikacija kupovine.

**Prvi tehnički korak:** podela `index.html` (116 KB) na `core.js` (čiste funkcije), `app.js` i CSS, uz build korak koji generiše SW verziju. Preduslov je za QA-01/05 i DST-02.

## 5. Rane odluke

1. **Bez naloga i servera (local-first).** To je ključna vrednost i drži proizvod u S1. Sinhronizacija preko servera bi prebacila projekat u S2.
2. **Vlasništvo nad podacima:** korisnik, na svom uređaju. Operator ne vidi knjige ni pozicije.
3. **Platforme:** PWA je izvor istine; Play preko TWA; iOS omotač postoji samo ako prođe Apple 4.2 (rizik odbijanja „tankog“ web omotača). Ako ne prođe, iOS ostaje PWA.
4. **Naplata — OTVORENO (kritična nepoznanica).** Jednokratna kupovina u prodavnicama zadržava S1 (prodavnice su Merchant of Record za svoj kanal). Web prodaja traži MoR provajdera koji podržava prodavca iz Srbije. Pretplata, sync ili nalozi znače S2. Odluka mora pre izbora billing integracije (LEG-02, BIL-01..03).
5. **Pravni režim:** GDPR (EU korisnici) + ZZPL; rukovalac je vlasnik/firma. Obim obrade je minimalan (IP u logovima hostinga i prodavnica).
6. **Deployment:** objava samo iz CI-ja sa git taga na `main`; objavljuje samo vlasnik; signing ključevi nikad u repou niti dostupni AI agentu.

## 6. Faze (izlazni kriterijum → ID-jevi koji se zatvaraju)

1. **Problem i zahtevi** — odluka o naplati, pravnom licu i jezicima; validacija potrebe. → PRD-01 (kriterijumi), PRD-03
2. **Arhitektura i dizajn** — ADR za odluke iz §5; threat model; procena Apple 4.2. → ARH-03, SEC-07  
   _Stanje 2026-10-24: `docs/architecture.md`, `docs/threat-model.md`, ADR 0001–0004 (nacrti, čekaju pregled)._
3. **Development foundation** — podela koda, testovi CORE-a u CI-ju, pinovan CI, `LICENSE`, `SECURITY.md`, uklonjeni debug paneli iz produkcije. → GOV-02, GOV-03, INF-02, QA-05, LEG-04, AI-01, AI-02
4. **Iterativna implementacija** — lokalni fontovi; CSP; validacija uvoza pozicija; nadogradnja pdf.js na 4.x; izvoz biblioteke; i18n UI-ja; TWA i iOS omotač; naplata (ako je odlučena). → PRV-04, SEC-03, SEC-06, DEX-01, ARH-02, BIL-*
5. **Security i quality hardening** — korpus zlonamernih PDF-ova, test kvote i prekida, kontrast i pristupačnost, performanse na velikim knjigama. → ARH-01, QA-03, UX-02, AI-03
6. **Release validation** — UAT po matrici platformi, dokazi upisani uz release commit. → PRD-01, PRD-02, QA-01, QA-04, INF-01, INF-04
7. **Pre-launch readiness** — privacy notice i obrasci prodavnica, pravne beleške (čl. 27, EAA, CRA, patenti), developer nalozi, `app-launch-check`. → PRV-01, PRV-02, PRV-08, LEG-01..03, CRA-01, DST-01, DST-02, GOV-01
8. **Kontrolisano lansiranje** — prvo PWA, pa Play (interni/zatvoreni test), pa App Store; smoke test u produkciji. → OPS-02, OPS-03
9. **Post-launch** — praćenje pdf.js ranjivosti, CRA prijave, kontinuitet dobavljača. → TPC-01

## 7. Nepoznanice

- **Kritične:** model naplate; pravni oblik (preduzetnik/DOO) i developer nalozi Apple/Google za srpsko lice; patentni rizik RSVP/ORP prikaza (patenti iz oblasti Spritz-a — stručna provera pre ulaganja u marketing); prihvatljivost iOS omotača (Apple 4.2).
- **Važne:** EAA izuzetak za mikropreduzeća; GDPR čl. 27(2) izuzetak; trenutni hosting i domen; jezici UI-ja (sada samo engleski; heuristike `ABBR`/`COMMON` su engleske); iOS Safari briše skladište neinstaliranih sajtova posle 7 dana neaktivnosti (uticaj na T4).
- **Manje važne:** ime i brend; minimalne verzije OS-a; da li zadržati „Paste text“.

Rokove propisa (CRA od 11. 9. 2026, EAA od 28. 6. 2025), pravila prodavnica i poreske pragove proveriti u primarnom izvoru na datum lansiranja.

## Definition of Done (svaki razvojni zadatak)

- Acceptance criteria su zadovoljeni.
- Diff je pregledao čovek (obavezno za P0 oblasti: uvoz PDF-a, SW/deploy, uvoz pozicija, naplata, i uvek kada je kod generisao AI).
- Testovi prolaze, uključujući neuspešne i granične slučajeve.
- Za izmene ličnih podataka ili naplate postoji kratka beleška o pretnjama i bar jedan negativan test.
- Dokumentacija i migracije su ažurirani.
- Nema poznatog kritičnog regresionog problema.
- Izmena se može sledljivo isporučiti (tag + CI) i vratiti na prethodnu verziju.
