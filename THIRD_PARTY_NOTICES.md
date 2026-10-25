# Third-party notices

| Component | Version | License | Where | Source |
|---|---|---|---|---|
| PDF.js (`pdfjs-dist`) | 3.11.174 | Apache License 2.0 (`licenses/pdfjs-Apache-2.0.txt`) | `vendor/pdf.min.js`, `vendor/pdf.worker.min.js` | https://github.com/mozilla/pdf.js, npm `pdfjs-dist` |
| Literata (variable, optical size) | Fontsource `@fontsource-variable/literata` 5.3.0 | SIL Open Font License 1.1 (`vendor/fonts/OFL-Literata.txt`) | `vendor/fonts/literata-*.woff2` | https://github.com/googlefonts/literata, npm |
| IBM Plex Sans 400/500/600, IBM Plex Mono 400/500 | Fontsource `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono` 5.3.0 | SIL Open Font License 1.1 (`vendor/fonts/OFL-IBM-Plex.txt`) | `vendor/fonts/ibm-plex-*.woff2` | https://github.com/IBM/plex, npm |

The vendored PDF.js files are byte-identical to the files published in the npm package `pdfjs-dist@3.11.174` (verified 2026-10-24).
The font files are copied unchanged from the Fontsource npm tarballs by `scripts/update-fonts.mjs`; only `vendor/fonts/fonts.css` is generated (family names and paths rewritten). Every vendored file is pinned in `vendor/SHA256SUMS` and checked by the build.

Test fixtures only (not shipped): `tests/fixtures/cyrillic.pdf` embeds a subset of DejaVu Serif (Bitstream Vera / DejaVu licence, free to embed and redistribute).
