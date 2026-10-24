# ADR 0003 — Sopstveni origin i hosting sa podrškom za headere

- Status: Predloženo (2026-10-24) — čeka potvrdu vlasnika i izbor domena
- Kontekst:
  - Svi lokalni podaci (IndexedDB, keš, localStorage) vezani su za origin.
  - Na `iroh138.github.io/<repo>` sve tvoje Pages aplikacije dele isti origin (threat model A12).
  - GitHub Pages ne dozvoljava sopstvene HTTP headere, pa nema `frame-ancestors` ni podesivog CSP header-a.
  - TWA za Google Play zahteva `/.well-known/assetlinks.json` na domenu aplikacije.
- Odluka (predlog): Aplikacija dobija sopstveni (pod)domen, npr. `read.<tvoj-domen>`, na statičkom hostingu koji podržava sopstvene headere i deploy iz CI-ja. Konkretni hosting bira vlasnik u fazi 3 (DPA i lokacija → PRV-02/PRV-04).
- Razlog: Izolacija podataka, puni sigurnosni headeri, stabilan domen za TWA i privacy notice.
- Posledice:
  - Prelazak sa trenutne adrese menja origin, pa se lokalni podaci **ne prenose sami**. Korisnici (za sada samo ti) prenose pozicije postojećim izvozom ili uvozom; knjige se uvoze ponovo.
  - Prelazak uraditi pre javnog lansiranja, dok je korisnika malo.
