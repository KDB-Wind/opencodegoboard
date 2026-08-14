import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

const manifest = resolve(process.argv[2] || 'src-tauri/target/release/bundle/SHA256SUMS');
const root = dirname(manifest);
for (const line of (await readFile(manifest, 'utf8')).trim().split(/\r?\n/)) {
  const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
  if (!match) throw new Error(`Invalid checksum line: ${line}`);
  const actual = createHash('sha256').update(await readFile(join(root, match[2]))).digest('hex');
  if (actual !== match[1]) throw new Error(`Checksum mismatch: ${match[2]}`);
}
console.log('All release checksums are valid.');
