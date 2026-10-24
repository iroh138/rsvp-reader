// SPDX-License-Identifier: AGPL-3.0-only
// Verifies vendored third-party files against vendor/SHA256SUMS (recorded from the official npm package
// pdfjs-dist@3.11.174). Fails the build if a vendored file was changed or added without updating the list.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

export async function verifyVendor() {
  const sums = (await readFile(join(root, 'vendor/SHA256SUMS'), 'utf8')).trim().split('\n').map(l => l.trim().split(/\s+/));
  const listed = new Set(sums.map(([, f]) => f));
  for (const [want, file] of sums) {
    const got = createHash('sha256').update(await readFile(join(root, file))).digest('hex');
    if (got !== want) throw new Error(`Checksum mismatch for ${file}: expected ${want}, got ${got}`);
  }
  for (const f of await readdir(join(root, 'vendor'))) {
    if (f !== 'SHA256SUMS' && !listed.has(`vendor/${f}`)) throw new Error(`vendor/${f} is not listed in vendor/SHA256SUMS`);
  }
  return sums.length;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const n = await verifyVendor();
  console.log(`vendor: ${n} files match SHA256SUMS`);
}
