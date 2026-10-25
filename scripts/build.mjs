// SPDX-License-Identifier: AGPL-3.0-only
// Production build: copies the app into dist/ and generates dist/sw.js from src/sw.template.js.
// The service worker version is a hash of every shipped file, so any change produces a new version.
// No dependencies; Node.js 22+.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyVendor } from './check-vendor.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const SHIP = ['index.html', 'styles.css', 'manifest.webmanifest', 'src/core.js', 'src/settings.js', 'src/storage.js', 'src/app.js', 'vendor/pdfjs', 'vendor/fonts', 'icons'];

async function filesUnder(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...await filesUnder(p)); else out.push(p);
  }
  return out;
}

await verifyVendor();
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const item of SHIP) await cp(join(root, item), join(dist, item), { recursive: true });

const shipped = (await filesUnder(dist)).map(p => relative(dist, p).split(sep).join('/')).sort();
const hash = createHash('sha256');
for (const f of shipped) { hash.update(f); hash.update('\0'); hash.update(await readFile(join(dist, f))); }
const template = await readFile(join(root, 'src/sw.template.js'), 'utf8');
hash.update(template);   // a change to the service worker itself also gives a new version
const version = hash.digest('hex').slice(0, 12);

for (const token of ['__VERSION__', '__FILES__']) {
  const n = template.split(token).length - 1;
  if (n !== 1) throw new Error(`sw.template.js must contain ${token} exactly once (found ${n})`);
}
const sw = template.replace('__VERSION__', version).replace('__FILES__', JSON.stringify(['./', ...shipped]));
if (/__[A-Z]+__/.test(sw)) throw new Error('dist/sw.js still contains a placeholder');
await writeFile(join(dist, 'sw.js'), sw);
await writeFile(join(dist, 'build.json'), JSON.stringify({ version, files: shipped.length, builtAt: new Date().toISOString() }, null, 2) + '\n');
console.log(`dist/ built: ${shipped.length} files, service worker version ${version}`);
