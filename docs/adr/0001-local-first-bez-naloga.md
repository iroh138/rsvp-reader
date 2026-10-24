# ADR 0001 — Local-first, bez naloga i servera

- Status: Prihvaćeno (2026-10-24)
- Kontekst: Aplikacija čuva PDF knjige, tokenizovane stranice i pozicije čitanja. Ključna poruka proizvoda je da knjige ostaju na uređaju. Scenario S1 važi samo dok nema naloga ni servera.
- Odluka: Svi korisnički podaci su u IndexedDB-u i localStorage-u na uređaju. Nema naloga, servera ni sinhronizacije. Prenos između uređaja ide kroz ručni izvoz i uvoz pozicija.
- Razlog: Najmanja površina napada, nema obrade ličnih podataka kod operatora, nema serverskih troškova ni RPO/RTO obaveza.
- Posledice:
  - Gubitak uređaja ili brisanje skladišta (posebno iOS Safari bez instalacije) znači gubitak biblioteke. Ublažavanje: `navigator.storage.persist()`, upozorenje (T4.4) i izvoz (DEX-01).
  - Migracije lokalne šeme moraju biti bezbedne na uređajima korisnika (ARH-02).
  - Uvođenje sync-a ili pretplate poništava ovu odluku i vraća projekat na `app-plan` (S2).
