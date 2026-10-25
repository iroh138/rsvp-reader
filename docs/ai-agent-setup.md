# AI-01 — Tehničke zaštite za rad sa AI agentima

`AGENTS.md` je uputstvo, a ne zaštita. Zaštite koje zaista važe su podešavanja ispod. Stavke označene **[vlasnik]** mora da uključi vlasnik repoa, jer agent nema ta prava.

| Zaštita | Šta sprečava | Stanje |
|---|---|---|
| Zaštita grane `main`: zabranjen direktan push, obavezan PR, obavezan prolaz CI-ja (`test-and-build`, `secret-scan`, `workflow-policy`) | Nepregledane izmene u produkcionom kodu (AI-03, GOV-03) | Urađeno 2026-10-25: ruleset `protect-main`; test direktnog push-a odbijen |
| Private vulnerability reporting | Javno objavljivanje ranjivosti (CRA-01) | Urađeno 2026-10-25 |
| Nema tajni u repou ni u CI-ju; `.gitignore` blokira `.env*` i ključeve; gitleaks na svakom PR-u | Curenje tajni preko agenta | Urađeno (ovaj PR) |
| `.npmrc`: `ignore-scripts=true` | Izvršavanje install skripti iz paketa koje agent predloži (AI-02) | Urađeno (ovaj PR) |
| Akcije pinovane na SHA + automatska provera u CI-ju + Dependabot | Kompromitovan tag akcije (INF-02) | Urađeno (ovaj PR) |
| Signing ključevi i nalozi prodavnica postoje samo kod vlasnika, nikad u okruženju agenta | Lažno ažuriranje u prodavnici (threat model A11) | Pravilo; proveriti pri postavljanju Play naloga |
| Deploy samo iz CI-ja, sa zaštićenim okruženjem i odobrenjem vlasnika | Agent ne može da objavi u produkciju | Biće urađeno kada se izabere hosting |

Napomena: agent ima push pravo na repo, ali od 2026-10-25 ruleset `protect-main` tehnički sprečava direktan push na `main`. Svaka izmena ide kroz PR sa zelenim CI-jem, a spaja je vlasnik.

Napomena o rulesetu: opcija `require_extra_approval_for_unattributed_changes` je uključena. Ako GitHub ubuduće zatraži odobrenje pri spajanju PR-a, uzrok je verovatno ova opcija.
