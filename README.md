# RSVP Speed Reader

Read PDF books one word at a time (rapid serial visual presentation), offline, on your own device. Books never leave the device: no account, no server, no tracking.

- Imports text-based PDFs (up to 200 MB). Running headers, footers and page numbers are skipped, and words split across lines or pages are joined.
- Choose where to start by tapping a word on the original page.
- Natural pauses at clauses, sentence ends and paragraphs; images pause reading and are shown in place.
- Installable as a web app (PWA) and works without a network after the first visit.

## Development

Requirements: Node.js 22+.

```sh
npm ci            # install exactly what package-lock.json lists
npm test          # unit tests (tokenizer, pivot, timing, cleanup)
npm run build     # production build in dist/ (verifies vendor checksums, generates sw.js)
npm run serve     # serve dist/ on http://localhost:8080
```

Open the app with `?dev` to show the in-app acceptance checks and the paste-text panel.

Browser smoke tests (optional, Python + Playwright): `python3 tests/e2e/smoke.py "http://localhost:8080/index.html?dev" tests/fixtures/book.pdf` and `python3 tests/e2e/offline.py http://localhost:8080/`. Test PDFs are generated with `python3 scripts/make-fixtures.py`.

Deploy the contents of `dist/`, not the repository root.

Project documents: `PLAN.md`, `CONTROLS.md`, `docs/`.

## License

Copyright © 2026 iroh138. Licensed under the GNU Affero General Public License v3.0 only (`LICENSE`).
Third-party components are listed in `THIRD_PARTY_NOTICES.md`.
