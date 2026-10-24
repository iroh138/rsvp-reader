# PRD-01 — Zahtevi i acceptance criteria

Datum: 2026-10-24 · Kod: `a44a0e2`
Kriterijumi su pisani za ciljno ponašanje, ne prepisani iz koda. Gde kod već radi drugačije, to je označeno kao **[razlika]**. Svaki kriterijum ima metod provere (U = unit test, E = E2E/ručni UAT, M = merenje).

## T1 — Uvoz PDF-a

| # | Ulaz → očekivano ponašanje | Provera |
|---|---|---|
| T1.1 | Tekstualni PDF ≤200 MB → knjiga u biblioteci sa naslovom (iz metapodataka ili imena fajla), brojem strana i reči, i porukom o trajanju uvoza | E |
| T1.2 | Isti fajl (isti SHA-256) ponovo → otvara postojeću knjigu, bez duplikata | E, U |
| T1.3 | Fajl koji nije PDF, oštećen PDF, PDF sa lozinkom ili skeniran PDF (bez tekstualnog sloja) → jasna poruka; ništa nije sačuvano | E |
| T1.4 | Fajl >200 MB → odbijen pre čitanja, uz poruku sa veličinom | E |
| T1.5 | Otkazivanje ili zatvaranje taba tokom uvoza → nema polovičnih zapisa (`pages` bez `documents`) | E (ARH-01) |
| T1.6 | Puna kvota skladišta → poruka sa zauzećem; ništa polovično nije sačuvano | E (ARH-01) |
| T1.7 | Ponavljajuća zaglavlja, podnožja i brojevi strana se ne čitaju; reč rastavljena na kraju reda ili strane čita se cela | U (korpus) |
| T1.8 | Uvoz knjige od 300 strana na referentnom Android uređaju ≤30 s; uvoz knjige od 1000 strana bez pada taba | M |

Neuspešni slučajevi: PDF koji obori pdf.js worker; stranice koje se ne mogu pročitati (broj se prijavljuje, uvoz se nastavlja); zlonamerni PDF (SEC-03).

## T2 — Izbor početka čitanja

| # | Ulaz → očekivano ponašanje | Provera |
|---|---|---|
| T2.1 | Tap na reč na originalnoj stranici → ta reč je označena, a „Read from here“ kreće tačno od nje | E, U (mapiranje) |
| T2.2 | Skok na stranicu N (1…ukupno) → prikaz te stranice; unos van opsega se ograničava | E |
| T2.3 | „Reading position“ → prikaz stranice sa trenutnom reči označenom | E |
| T2.4 | Tap na zaglavlje ili broj strane koji se preskače → čitanje kreće od prve sledeće vidljive reči | U |

## T3 — RSVP čitanje

| # | Ulaz → očekivano ponašanje | Provera |
|---|---|---|
| T3.1 | Brzina 100–1000 wpm u koracima od 25; podešavanje se pamti | U, E |
| T3.2 | Tačnost tempa: 120 reči pri 600 wpm, odstupanje ukupnog trajanja ≤2 % | M (postojeća in-app provera) |
| T3.3 | Pauze: rečenica = 1,5–4× (podesivo), pasus = rečenica + 0,5×, zarez/tačka-zarez/crta 1,5×, duge reči 1,2× (≥9) i 1,4× (≥13); skraćenice (npr. „e.g.“, „Dr.“) ne prave pauzu rečenice | U |
| T3.4 | Pivot slovo je na fiksnoj horizontalnoj poziciji za svaku reč | U, E |
| T3.5 | Pauza pa nastavak → kreće od početka tekuće rečenice, najviše 20 reči unazad | U |
| T3.6 | Slika u knjizi → čitanje staje na njenom mestu, slika se prikazuje, a „Continue“ nastavlja | E |
| T3.7 | Tab ili aplikacija u pozadini → čitanje se pauzira bez preskakanja reči | E |
| T3.8 | Uvoz podešavanja sa neispravnim vrednostima (string, negativan broj, van opsega) → odbijeno ili ograničeno na opseg | U **[razlika: `index.html:1762, 1782` ne validira]** |

## T4 — Nastavak čitanja

| # | Ulaz → očekivano ponašanje | Provera |
|---|---|---|
| T4.1 | Zatvaranje aplikacije tokom čitanja → ponovno otvaranje nastavlja sa gubitkom ≤5 s čitanja | E |
| T4.2 | Ažuriranje aplikacije (nova SW verzija, `PROCESSOR_VERSION`) → iste pozicije, iste knjige | E (ARH-02) |
| T4.3 | Izvoz pozicija na uređaju A → uvoz na uređaju B sa istim PDF-om → ista reč; novija pozicija na B se ne prepisuje | E, U |
| T4.4 | iOS Safari bez instalacije: korisnik je upozoren da skladište može biti obrisano posle neaktivnosti i dobija ponudu za instalaciju | E **[razlika: upozorenje ne postoji]** |

## T5 — Instalacija, offline, ažuriranje

| # | Ulaz → očekivano ponašanje | Provera |
|---|---|---|
| T5.1 | Instalacija kao PWA (Android Chrome, desktop Chrome/Edge, iOS „Add to Home Screen“) | E |
| T5.2 | Posle prve instalacije sve funkcije rade bez mreže, uključujući fontove | E **[razlika: fontovi dolaze sa Google-a]** |
| T5.3 | Nema mrežnih zahteva van sopstvenog origin-a | M (mrežni log, čist profil) **[razlika]** |
| T5.4 | Nova verzija se primenjuje bez gubitka podataka; prethodna verzija se može vratiti | E (INF-04) |
| T5.5 | Store build (Play, eventualno iOS) ima isto ponašanje kao PWA za T1–T4 | E (QA-04) |

## Merljivi NFR

| NFR | Cilj | Provera |
|---|---|---|
| Privatnost | 0 zahteva van origin-a; nikakva analitika bez pristanka | Mrežni log (M) |
| Bezbednost | CSP bez `unsafe-eval`; pdf.js aktuelan; `isEvalSupported:false` | Pregled + SCA |
| Performanse | T1.8; prvi prikaz iz keša ≤2 s | M na referentnom uređaju (**treba izabrati**) |
| Dostupnost | 100 % funkcija offline posle instalacije | E |
| Podaci | Pozicija se čuva najmanje svakih 5 s i pri `pagehide` | U, E |
| Pristupačnost | WCAG 2.2 AA za UI van RSVP prozora (kontrast ≥4,5:1, fokus, tastatura) | Izveštaj (QA-03) |

## MVP opseg

**U MVP-u:** T1–T5; uklanjanje debug panela iz produkcije („Milestone“ oznaka, „Acceptance checks“; „Paste text“ je odluka).
**Backlog (zavisi od odluka u `03-memo-naplata.md`):** EPUB (H7); i18n UI-ja i heuristike za druge jezike; izvoz cele biblioteke; iOS omotač; sinhronizacija (pomera projekat u S2).
