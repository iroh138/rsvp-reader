# AI-01 — Tehničke zaštite za rad sa AI agentima

`AGENTS.md` je uputstvo, a ne zaštita. Zaštite koje zaista važe su podešavanja ispod. Stavke označene **[vlasnik]** mora da uključi vlasnik repoa, jer agent nema ta prava.

| Zaštita | Šta sprečava | Stanje |
|---|---|---|
| Zaštita grane `main`: zabranjen direktan push, obavezan PR, obavezan prolaz CI-ja (`test-and-build`, `secret-scan`, `workflow-policy`) | Nepregledane izmene u produkcionom kodu (AI-03, GOV-03) | **[vlasnik]** Settings → Branches → Add rule |
| Private vulnerability reporting | Javno objavljivanje ranjivosti (CRA-01) | **[vlasnik]** Settings → Code security |
| Nema tajni u repou ni u CI-ju; `.gitignore` blokira `.env*` i ključeve; gitleaks na svakom PR-u | Curenje tajni preko agenta | Urađeno (ovaj PR) |
| `.npmrc`: `ignore-scripts=true` | Izvršavanje install skripti iz paketa koje agent predloži (AI-02) | Urađeno (ovaj PR) |
| Akcije pinovane na SHA + automatska provera u CI-ju + Dependabot | Kompromitovan tag akcije (INF-02) | Urađeno (ovaj PR) |
| Signing ključevi i nalozi prodavnica postoje samo kod vlasnika, nikad u okruženju agenta | Lažno ažuriranje u prodavnici (threat model A11) | Pravilo; proveriti pri postavljanju Play naloga |
| Deploy samo iz CI-ja, sa zaštićenim okruženjem i odobrenjem vlasnika | Agent ne može da objavi u produkciju | Biće urađeno kada se izabere hosting |

Napomena o pravima u ovoj sesiji: agent je radio na grani `phase-3-foundation` i ima push pravo na repo. Bez zaštite grane `main` tehnički bi mogao da pushuje i direktno na `main`, pa je zaštita grane prioritet.
