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

Browser tests (optional, Python + Playwright). Serve `dist/` with `npm run serve`, then:

- `python3 tests/e2e/smoke.py "http://localhost:8080/index.html?dev" tests/fixtures/book.pdf`: in-app checks and PDF import
- `python3 tests/e2e/pdf-corpus.py http://localhost:8080/`: every PDF in `tests/fixtures/` against `tests/fixtures/golden.json` (`--write` re-records it; see `docs/pdf-corpus.md`)
- `python3 tests/e2e/offline.py http://localhost:8080/`: installs, then works without a network
- `python3 tests/e2e/fonts.py http://localhost:8080/`: no third-party requests, bundled fonts in use
- `python3 tests/e2e/positions.py http://localhost:8080/`: invalid imported or stored settings cannot break the reader
- `python3 tests/e2e/upgrade.py <old dist> dist tests/fixtures/book.pdf`: updating from a previous build keeps the library
- `python3 tests/e2e/old-browser.py http://localhost:8080/`: a browser too old for pdf.js 6 gets a clear message
- `python3 tests/e2e/scroll-pause.py http://localhost:8080/`: reading stops when the reader is scrolled off screen (and only then)
- `python3 tests/e2e/csp.py http://localhost:8080/`: the app works under the production headers with zero Content-Security-Policy violations
- with the repository root served (`node scripts/serve.mjs . 8080`): `python3 tests/e2e/storage.py http://localhost:8080/`: database migrations, rollback, other open tabs

Test PDFs are generated with `python3 scripts/make-fixtures.py` (deterministic).

Updating pdf.js: `scripts/update-pdfjs.mjs` (instructions inside), then run the PDF corpus check against the golden file. Hosting must serve `.mjs` as `text/javascript` and `.wasm` as `application/wasm`, and a CSP must allow `'wasm-unsafe-eval'` (see `docs/adr/0005-pdfjs-6-i-podrzani-pregledaci.md`).

Changing the IndexedDB schema: add a new function to `MIGRATIONS` in `src/storage.js`; never edit a shipped one.

## Deployment

Production runs on Cloudflare Pages (project `read`, `docs/adr/0003-sopstveni-origin-i-hosting.md`). Deploys come only from CI: GitHub → Actions → *Deploy production (Cloudflare Pages)* → *Run workflow* on `main`. The workflow tests, builds, deploys `dist/` with Wrangler (exact versions in `deploy/package-lock.json`) and then checks the live site (`scripts/verify-deploy.mjs`).

- Security headers live in `hosting/_headers` and are copied into `dist/` by the build. `npm run serve` applies them too.
- The Cloudflare and GitHub accounts must have two-factor authentication. Whoever controls either account can ship code to every user.
- Deploy the contents of `dist/`, not the repository root.

Project documents: `PLAN.md`, `CONTROLS.md`, `docs/`.

## License

Copyright © 2026 iroh138. Licensed under the GNU Affero General Public License v3.0 only (`LICENSE`).
Third-party components are listed in `THIRD_PARTY_NOTICES.md`.
