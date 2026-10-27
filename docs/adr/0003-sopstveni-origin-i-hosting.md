# ADR 0003 — Sopstveni origin i hosting sa podrškom za headere

- Status: Prihvaćeno (2026-10-27): Cloudflare Pages, projekat `read`, besplatna adresa `*.pages.dev` (vidi „Odluka 2026-10-27“ na kraju)
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

- Potvrđeno 2026-10-25: stara verzija aplikacije je objavljena na `iroh138.github.io/speed-reading-app/`. Svaka druga Pages aplikacija na `iroh138.github.io` deli sa njom IndexedDB, localStorage i Cache Storage. Test build na `/rsvp-reader/` se zato otvara samo u incognito tabu (`docs/platforms.md`).

## Odluka 2026-10-27

- **Hosting:** Cloudflare Pages, projekat `read`. Bez sopstvenog domena za sada. Ime `read` je bilo zauzeto, pa je produkciona adresa **`https://read-8zp.pages.dev/`** (prvo objavljivanje 2026-10-27).
- **Origin:** `read.pages.dev` je sopstveni origin, pa je A12 (deljeni origin na `github.io`) rešen.
- **Deploy:** samo iz CI-ja (`.github/workflows/deploy.yml`), ručno pokretanje iz `main`. Token je tajna GitHub okruženja `production`. Posle svakog deploy-a `scripts/verify-deploy.mjs` proverava živi sajt.
- **Headeri:** `hosting/_headers` (CSP, HSTS, nosniff, Referrer-Policy, Permissions-Policy, COOP, CORP, X-Frame-Options). Lokalni server ih primenjuje, pa svi browser testovi rade pod produkcionim CSP-om (`tests/e2e/csp.py`: 0 kršenja politike).
- **Zamenjivost:** build je statički `dist/`. Za drugi hosting treba samo prevesti `_headers` u njegov format i zameniti deploy korak.

Posledice:
- **Prelazak na sopstveni domen kasnije ponovo menja origin.** Lokalni podaci se ne prenose sami (pozicije idu izvozom i uvozom, knjige se uvoze ponovo). Domen zato treba uzeti **pre javnog lansiranja i pre TWA/Play izdanja**, jer je `assetlinks.json` vezan za domen.
- Svaki deploy dobija i svoju trajnu preview adresu (`<hash>.read.pages.dev`). Stare verzije ostaju dostupne na tim adresama dok se deploy ne obriše u Cloudflare-u. To su drugi origin-i, pa ne vide podatke korisnika. Headeri im dodaju `X-Robots-Tag: noindex`.
- `pages.dev` je zajednički domen svih Cloudflare korisnika. Druge aplikacije na `*.pages.dev` su drugi origin-i i ne vide podatke ove aplikacije.

Činjenice o dobavljaču (provereno 2026-10-27, nije pravni savet):
- Self-Serve Subscription Agreement (https://www.cloudflare.com/terms/) važi i za besplatne usluge. Član 6.1 uključuje Data Processing Addendum kada sadržaj korisnika sadrži lične podatke. U samom ugovoru nije nađena zabrana komercijalne upotrebe besplatnog plana. Service-Specific Terms za Pages nisu pročitani.
- DPA (https://www.cloudflare.com/cloudflare-customer-dpa/), čl. 6.4: Cloudflare je u EU-US Data Privacy Framework-u. Za ostale prenose važe SCC (Odluka 2021/914).
- Isti ugovor, čl. 2.6: za besplatne usluge Cloudflare ne odgovara za štetu i može da ih ukine po sopstvenoj odluci. Zato rezervni plan (TPC-01): GitHub Pages test build i bilo koji statički hosting koji podržava headere.
