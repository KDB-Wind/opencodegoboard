import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'src-tauri/target/release/bundle');
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => entry.isDirectory() ? files(join(directory, entry.name)) : [join(directory, entry.name)]));
  return nested.flat();
}
const artifacts = (await files(root)).filter((path) => !path.endsWith('SHA256SUMS'));
const lines = [];
for (const artifact of artifacts.sort()) {
  const digest = createHash('sha256').update(await readFile(artifact)).digest('hex');
  lines.push(`${digest}  ${relative(root, artifact).replaceAll('\\', '/')}`);
}
await writeFile(join(root, 'SHA256SUMS'), `${lines.join('\n')}\n`, 'utf8');
console.log(`Wrote ${lines.length} checksums to ${join(root, 'SHA256SUMS')}`);
