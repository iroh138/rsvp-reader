// SPDX-License-Identifier: AGPL-3.0-only
// Regenerates vendor/pdfjs/ from an extracted pdfjs-dist npm tarball (no npm install, no install scripts).
// Uses the LEGACY build (widest browser support: Chrome 125+, Safari 18+ per the pdf.js FAQ) and only the
// WebAssembly decoders the app needs for page images: JPEG 2000 (openjpeg), JBIG2 and ICC colour (qcms).
// Deliberately NOT copied: quickjs-eval (PDF JavaScript sandbox, an eval engine), the *_nowasm_fallback.js files,
// source maps, the viewer.
//
// Usage (owner, when updating pdf.js):
//   mkdir /tmp/p && cd /tmp/p && npm pack pdfjs-dist@6.4.299 && mkdir x && tar xzf pdfjs-dist-6.4.299.tgz -C x
//   node scripts/update-pdfjs.mjs /tmp/p/x/package
// Then update vendor/SHA256SUMS and THIRD_PARTY_NOTICES.md, run the PDF corpus check and review the diff.
import { copyFile, mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = process.argv[2];
if (!pkg) { console.error('usage: node scripts/update-pdfjs.mjs <extracted pdfjs-dist package folder>'); process.exit(1); }
const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'vendor/pdfjs');
const { name, version } = JSON.parse(await readFile(join(pkg, 'package.json'), 'utf8'));
if (name !== 'pdfjs-dist') throw new Error(`not pdfjs-dist: ${name}`);

const FILES = [
  ['legacy/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
  ['LICENSE', 'LICENSE'],
  ['wasm/openjpeg.wasm', 'wasm/openjpeg.wasm'],
  ['wasm/jbig2.wasm', 'wasm/jbig2.wasm'],
  ['wasm/qcms_bg.wasm', 'wasm/qcms_bg.wasm'],
  ['wasm/LICENSE_OPENJPEG', 'wasm/LICENSE_OPENJPEG'],
  ['wasm/LICENSE_PDFJS_OPENJPEG', 'wasm/LICENSE_PDFJS_OPENJPEG'],
  ['wasm/LICENSE_JBIG2', 'wasm/LICENSE_JBIG2'],
  ['wasm/LICENSE_PDFJS_JBIG2', 'wasm/LICENSE_PDFJS_JBIG2'],
  ['wasm/LICENSE_QCMS', 'wasm/LICENSE_QCMS'],
  ['wasm/LICENSE_PDFJS_QCMS', 'wasm/LICENSE_PDFJS_QCMS'],
];
await rm(out, { recursive: true, force: true });
await mkdir(join(out, 'wasm'), { recursive: true });
for (const [from, to] of FILES) await copyFile(join(pkg, from), join(out, to));
console.log(`vendor/pdfjs: ${name}@${version} legacy build, ${FILES.length} files`);
