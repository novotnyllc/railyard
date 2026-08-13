import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const diagrams = ['m1-convergence', 'm2-delivery-lifecycle', 'm3-trust-ratchet', 'm4-trust-boundaries', 'm5-model-routing', 'm6-review-gates', 'm7-skill-sync', 'm8-canary-evidence', 'm9-enrollment', 'm10-anti-rollback'];
const required = ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'assets/railyard-icon.png', 'og/railyard-og.svg', 'og/railyard-og.png', 'assets/hero-rail.svg', ...diagrams.map((name) => `diagrams/${name}.svg`)];
const icons = ['ship', 'review', 'fleet', 'skill', 'state', 'harness', 'build', 'machine', 'remote', 'cost'];
const failures = [];
for (const file of [...required, ...icons.map((icon) => `assets/scenarios/${icon}.svg`)]) if (!existsSync(join(root, file))) failures.push(`missing ${file}`);
for (const file of ['favicon.svg', 'assets/hero-rail.svg', 'og/railyard-og.svg', ...diagrams.map((name) => `diagrams/${name}.svg`), ...icons.map((icon) => `assets/scenarios/${icon}.svg`)]) {
  if (!existsSync(join(root, file))) continue;
  const text = readFileSync(join(root, file), 'utf8');
  if (!/<svg\b[^>]*\bviewBox=/.test(text)) failures.push(`no viewBox ${file}`);
  if (file.startsWith('diagrams/') && !/<svg\b[^>]*\brole="img"/.test(text)) failures.push(`diagram is not announced ${file}`);
  if (file.startsWith('diagrams/') && !/aria-labelledby="title desc"/.test(text)) failures.push(`diagram lacks title/description binding ${file}`);
  if (file === 'favicon.svg' && /<image\b|\bhref=/.test(text)) failures.push('favicon.svg must be self-contained');
}
const pngSize = (file) => { const b = readFileSync(join(root, file)); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
for (const [file, expected] of [['favicon-16.png', [16, 16]], ['favicon-32.png', [32, 32]], ['apple-touch-icon.png', [180, 180]], ['assets/railyard-icon.png', [512, 512]], ['og/railyard-og.png', [1200, 630]]]) {
  if (!existsSync(join(root, file))) continue;
  const size = pngSize(file);
  if (size.width !== expected[0] || size.height !== expected[1]) failures.push(`wrong dimensions ${file}: ${size.width}x${size.height}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`asset check: ${required.length + icons.length} required assets present; OG 1200x630; favicon 16/32/180px; diagrams M1-M10 accessible`);
