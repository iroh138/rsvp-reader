# Incident 2026-10-27: produkcija ne otvara stranicu posle prve posete (ERR_FAILED)

- **Uticaj:** https://read-8zp.pages.dev/, build `55313d731477` (prvo produkciono objavljivanje, oko 22:21–23:xx). Prva poseta radi. Svaka sledeća poseta u istom pregledaču daje „This site can't be reached · ERR_FAILED“. Incognito radi. Pogođen je samo vlasnik, jer adresa nije bila deljena.
- **Uzrok:** service worker je čuvao `index.html` i vraćao ga za svako otvaranje stranice. Cloudflare Pages odgovara na `/index.html` preusmerenjem (308) na `/`, pa je sačuvani odgovor označen kao preusmeren. Chrome takav odgovor odbija za otvaranje stranice.
- **Zašto testovi nisu uhvatili:** lokalni test server i GitHub Pages ne preusmeravaju `index.html`. Provera živog sajta (`verify-deploy.mjs`) proverava headere i tipove fajlova, ali ne i drugu posetu sa aktivnim service worker-om.
- **Ispravka:** service worker za otvaranje stranice koristi `./`, a svaki fajl čuva kao običnu kopiju, bez oznake preusmerenja. Lokalni server sada preusmerava `index.html` kao Pages, pa `tests/e2e/offline.py` pada na starom, a prolazi na novom kodu.
- **Oporavak kod korisnika:** posle objavljivanja ispravke prvo otvaranje još jednom javi grešku (stari service worker tada preuzima novi), a od drugog sve radi. Provereno testom (`upgrade.py` beleži `first_visit_failed_then_recovered`). Brisanje podataka sajta nije potrebno, pa se biblioteka čuva.
- **Pouka:** lokalni server treba da oponaša ponašanje produkcionog hostinga (preusmerenja, headere). Prvi deploy na novi hosting treba proveriti i drugom posetom, ne samo prvom.
