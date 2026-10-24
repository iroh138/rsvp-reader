# Memo — model naplate i kritične nepoznanice

Datum: 2026-10-24 · **Odluku donosi vlasnik.** Ovaj memo daje opcije, posledice i proverene činjenice. Nije pravni ni poreski savet.

## 1. Opcije naplate

| Opcija | Scenario | Šta uvodi | Prednost | Rizik |
|---|---|---|---|---|
| A. Besplatno (bez naplate) | S1 | Ništa | Najbrže do korisnika; validira H4/H5 | Nema prihoda; troškovi naloga u prodavnicama ostaju |
| B. Jednokratna kupovina u prodavnicama (plaćena aplikacija ili „unlock“ IAP) | S1 | Play Billing / StoreKit; BIL-01, BIL-03, LEG-02 | Prodavnica je Merchant of Record za svoj kanal; nema servera | PWA na webu ostaje besplatna ili traži posebnu web prodaju; licenca se proverava offline (deljenje, FRD-01) |
| C. Web prodaja licence preko MoR-a (npr. Paddle) | S1 → S2 | Ključ licence ili nalog; webhook ili server za verifikaciju | Isti proizvod na svim kanalima | Bez servera je provera licence samo klijentska (BIL-01 se teško ispunjava); sa serverom prelazak u S2 |
| D. Pretplata / freemium sa sync-om | **S2** | Nalozi, server, baza, sync, webhook-ovi, podrška | Ponavljajući prihod; jača ponuda (sync) | Najveći trošak i obaveze; ruši poruku „sve na uređaju“ |

**Uslovna preporuka:** opcija **A** za PWA i Google Play dok se ne zatvori PRD-03 (validacija). Zatim opcija **B** na Google Play-u, ako je H4 potvrđena. Opcija D tek kada sync postane potvrđena potreba korisnika.

## 2. Proverene činjenice (na dan 2026-10-24; proveriti ponovo pre lansiranja)

- **Google Play:** Srbija je na listi podržanih lokacija za merchant registraciju, sa isplatom u USD. Prodaja plaćenih aplikacija i IAP-a iz Srbije je, dakle, moguća.
- **Paddle (MoR za web prodaju):** Srbija nije na Paddle-ovoj listi nepodržanih zemalja. Paddle navodi da radi sa softverskim firmama svuda osim u nepodržanim zemljama, i da može tražiti dodatne podatke.
- **Apple:** nisam našao primarni izvor koji potvrđuje dostupnost Paid Applications Agreement-a i isplate na srpski račun. **Nepotvrđeno.** Proveriti direktno u Apple Developer nalogu.
- **Apple guideline 4.2 (Minimum Functionality):** aplikacija mora biti više od „prepakovanog sajta“, a nekorisne aplikacije bez app-like osobina se odbijaju. Za ovaj projekat to znači da tanak WKWebView omotač oko PWA ima realan rizik odbijanja. Nativne osobine (Files/Share import, offline biblioteka, nativni meniji) smanjuju taj rizik, ali ga ne uklanjaju.

## 3. Patentni rizik (RSVP sa fiksnim položajem tačke prepoznavanja)

- Spritz-ova prijava **WO2014011884A1** („Serial text display for optimal recognition apparatus and method“, prioritet 12. 7. 2012) ima evropski patent **EP2872984B1**, odobren 12. 9. 2018. Google Patents za njega navodi status „Not-in-force“ i predviđeno isticanje 11. 7. 2033. Google naglašava da je to pretpostavka, a ne pravni zaključak.
- **Zahtev 1** opisuje serijski prikaz reči u kom je tačka optimalnog prepoznavanja na fiksnom mestu na ekranu, pomereno od centra ka početku reči. Ova aplikacija radi upravo to: pivot je na fiksnoj poziciji od 38 % širine (`index.html:925`, `anchorX = W * 0.38`).
- Porodica obuhvata i CN, JP i ES dokumente. Američki član porodice nije pronađen na pregledanoj stranici, ali to **ne znači da ne postoji**.
- To što mnoge aplikacije koriste istu mehaniku **nije dokaz** da rizika nema.

**Akcija (pre ulaganja u marketing i plaćenu distribuciju):**
1. Proveriti status EP2872984 po zemljama u European Patent Register-u (besplatno).
2. Proveriti US i druge članove porodice.
3. Ako je bilo šta na snazi na ciljnim tržištima, konsultovati patentnog zastupnika (LEG-01).

## 4. Ostale kritične nepoznanice — potrebni odgovori vlasnika

1. **Model naplate:** A / B / C / D (ili kombinacija po kanalu).
2. **Pravni oblik:** preduzetnik ili DOO, i da li je već registrovan. Određuje tip developer naloga (lični ili organizacija), poreski tretman (knjigovođa) i trader status prema EU DSA.
3. **EPUB:** dodati u MVP ili ne (H7).
4. **Jezici UI-ja** za lansiranje.
5. **Hosting i domen** PWA verzije.

## Izvori

- [Google Play Console — Supported locations for developer and merchant registration](https://support.google.com/googleplay/android-developer/answer/9306917?hl=en)
- [Paddle — Which countries are supported by Paddle](https://www.paddle.com/help/legal/sanctions/which-countries-are-supported-by-paddle)
- [Apple App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Google Patents — WO2014011884A1](https://patents.google.com/patent/WO2014011884A1/en)
- [Google Patents — EP2872984B1](https://patents.google.com/patent/EP2872984B1/en)
