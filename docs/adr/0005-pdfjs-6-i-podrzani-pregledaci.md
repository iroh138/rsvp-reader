# ADR 0005 — pdf.js 6 (legacy build) i minimalne verzije pregledača

- Status: **Prihvaćeno (2026-10-25, vlasnik)**. Dodatni zahtev vlasnika: mora da radi na Androidu 10. To je ispunjeno, jer Android 10 dobija aktuelan Chrome (`docs/platforms.md`).
- Kontekst:
  - pdf.js 3.11.174 je zastareo. Ranjiv je na CVE-2024-4367 (zaštita `isEvalSupported: false` je postojala) i ne dobija ispravke.
  - Aktuelna verzija je 6.4.299. Prema zvaničnom pdf.js FAQ-u, moderni build cilja samo najnovije pregledače i Safari ne navodi. **Legacy build traži Chrome 125+ i Safari 18+** („mostly“). Ovo je provereno 2026-10-25 i treba ponovo proveriti na dan lansiranja.
  - Tekstualni sloj u 6.x koristi CSS `round()`, koji stariji pregledači nemaju.
- Odluka (predlog): legacy build pdf.js 6.4.299 uz WebAssembly dekodere za JPEG 2000, JBIG2 i ICC boje. PDF JavaScript engine (quickjs) se ne isporučuje.
- Posledice:
  - **Podržani pregledači:** Chrome / Android Chrome 125+ (maj 2024), Safari / iOS 18+ (septembar 2024), aktuelni Firefox i Edge.
    - Korisnici sa iOS 17 i starijim gube podršku za uvoz i prikaz PDF-a.
    - Čitanje već uvezenih knjiga ne zavisi od pdf.js-a, ali tap-to-word i prikaz stranice zavise.
    - Ulazi u QA-04 matricu (`docs/platforms.md`).
    - Prestar pregledač dobija jasnu poruku umesto pokvarenog uvoza (`pdfSupported()` u `src/app.js`, test `tests/e2e/old-browser.py`).
  - **CSP** mora dozvoliti WebAssembly: `script-src 'self' 'wasm-unsafe-eval'`. To nije `unsafe-eval` i ne dozvoljava `eval()` u JavaScript-u.
  - **Hosting** mora služiti `.mjs` kao `text/javascript` i `.wasm` kao `application/wasm`.
  - Veličina keša raste za ~1,1 MB (biblioteka ~1,8 MB + wasm ~450 KB, umesto ~1,4 MB).
- Alternativa: ostati na 3.11.174 radi starijih uređaja. Ta verzija je ranjiva (zaštita postoji, ali je jedina) i bez ispravki. Za komercijalni proizvod se ne preporučuje.
