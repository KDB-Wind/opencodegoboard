import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../src/index.css', import.meta.url), 'utf8');
const chart = await readFile(new URL('../src/components/DailyChart.tsx', import.meta.url), 'utf8');
const layout = await readFile(new URL('../src/components/Layout.tsx', import.meta.url), 'utf8');
const failures = [];
if (/\*:focus\s*\{[^}]*outline:\s*none/is.test(css)) failures.push('global focus outline is suppressed');
if (!css.includes(':focus-visible')) failures.push('focus-visible style is missing');
if (!layout.includes('skip-link')) failures.push('skip-to-content link is missing');
if (!chart.includes('accessibilityLayer')) failures.push('Recharts accessibility layer is missing');
if ((chart.match(/strokeDasharray=/g) ?? []).length < 2) failures.push('comparison lines rely on color alone');
if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('Accessibility regression checks passed.');
