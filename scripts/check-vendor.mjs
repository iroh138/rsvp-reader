// SPDX-License-Identifier: AGPL-3.0-only
// Verifies vendored third-party files against vendor/SHA256SUMS (recorded from the official npm packages
// pdfjs-dist@6.4.299 and Fontsource 5.3.0, see THIRD_PARTY_NOTICES.md). Fails the build if a vendored file was changed or added without updating the list.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function verifyVendor() {
  const sums = (await readFile(join(root, 'vendor/SHA256SUMS'), 'utf8')).trim().split('\n').map(l => l.trim().split(/\s+/));
  const listed = new Set(sums.map(([, f]) => f));
  for (const [want, file] of sums) {
    const got = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
    if (got !== want) throw new Error(`Checksum mismatch for ${file}: expected ${want}, got ${got}`);
  }
  for (const e of await readdir(join(root, 'vendor'), { recursive: true, withFileTypes: true })) {
    if (!e.isFile()) continue;
    const f = relative(root, join(e.parentPath, e.name)).split(sep).join('/');
    if (f !== 'vendor/SHA256SUMS' && !listed.has(f)) throw new Error(`${f} is not listed in vendor/SHA256SUMS`);
  }
  return sums.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = await verifyVendor();
  console.log(`vendor: ${n} files match SHA256SUMS`);
}
