# Stanja ekrana (UX-02)

Datum: 2026-10-27 · Automatska provera: `tests/e2e/states.py` (16 provera; 4 padaju na kodu pre ove izmene).

Za svaki glavni ekran: šta korisnik vidi dok se čeka (učitavanje), kada nema sadržaja (prazno), kada nešto ne uspe (greška) i kada uspe (uspeh). Greška nikad ne ostavlja tekst učitavanja na ekranu.

| Ekran | Učitavanje | Prazno | Greška | Uspeh | Dokaz |
|---|---|---|---|---|---|
| Biblioteka | „Loading your library…“ dok se baza otvara (**novo**) | „No books yet. Add a PDF with a text layer…“ | Crvena poruka: nije PDF, oštećen, lozinka, skeniran, nema prostora, nema skladišta u privatnom prozoru | Zelena poruka „Added …“ sa brojem strana i reči | states.py; pdf-corpus.py; integrity.py |
| Uvoz PDF-a | Traka i „Reading file… → Opening PDF… → Page n / N → Saving…“, dugme Cancel | — | Poruka; ništa nije sačuvano | Knjiga se otvara u čitaču | states.py; integrity.py |
| Čitač | „Opening “naslov”…“ dok se knjiga čita iz skladišta (**novo**) | Ugrađen uzorak teksta, označen „Sample text“ (ranije pogrešno „Pasted text“) | „This book is incomplete…“ i slične poruke; tekst „Opening…“ se uklanja (**novo**) | Procenat, strana i preostalo vreme | states.py |
| Pregled dokumenta | Siva oznaka „Page n“ dok se strana iscrtava | — | Ceo PDF: poruka ispod strana. Pojedinačna strana: „Could not show page n“ umesto večno prazne strane, nov pokušaj kada se ponovo pojavi (**novo**) | Strana sa izborom reči | states.py |
| Slika tokom čitanja | Natpis „Image · page n“ dok se slika iscrtava | — | „Could not show the image on page n · continue to keep reading“ | Iscrtana slika, Continue | states.py |
| Ažuriranje stare knjige | Traka „Updating …“ | — | „Could not update this book: …“ | Knjiga se otvara | upgrade.py |
| Rezervna kopija / vraćanje | „Preparing backup: book n / N…“, „Restoring book n / N…“ | „The library is empty. There is nothing to back up.“ | „This file is not a library backup…“, delimično vraćanje sa razlogom | „Saved …“, „Restored n of N…“ | backup.py; integrity.py |
| Pozicije čitanja | — | Prazna lista se kopira bez greške | „That text is not a list of reading positions…“ | „Applied n of N…“ | positions.py |

Kontrast oznake „Page n“ na beloj strani podignut je sa 2,8:1 na 6,4:1 (QA-03).

Nije pokriveno automatski: izgled svih stanja na pravim uređajima (QA-04) i test upotrebljivosti sa korisnicima (UX-01).
