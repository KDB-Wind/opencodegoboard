import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error('Usage: node scripts/sanitize-fixture.mjs <captured-response> <safe-fixture>');
  process.exit(2);
}
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12);
const source = await readFile(inputPath, 'utf8');
const sanitized = source
  .replace(/(authorization\s*[:=]\s*(?:bearer\s+)?)[^\s,"']+/gi, '$1[REDACTED]')
  .replace(/((?:set-)?cookie\s*[:=]\s*)[^\r\n]+/gi, '$1[REDACTED]')
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[EMAIL]')
  .replace(/\b(?:wrk|ses|user|key)[_-][a-z0-9_-]{6,}\b/gi, (value) => `[ID:${fingerprint(value)}]`)
  .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi, (value) => `[UUID:${fingerprint(value)}]`)
  .replace(/(["'](?:auth_cookie|token|secret|password)["']\s*:\s*["'])[^"']+(["'])/gi, '$1[REDACTED]$2');
await writeFile(outputPath, sanitized, { encoding: 'utf8', flag: 'wx' });
console.log(`Sanitized fixture written to ${outputPath}. Review it manually before committing.`);
