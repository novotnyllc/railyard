import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../dist/', import.meta.url).pathname;
const required = ['favicon.svg', 'favicon-16.png', 'favicon-32.png', 'apple-touch-icon.png', 'og/railyard-og.svg', 'og/railyard-og.png', 'assets/hero-rail.svg'];
const icons = ['ship', 'review', 'fleet', 'skill', 'state', 'harness', 'build', 'machine', 'remote', 'cost'];
const failures = [];
for (const file of [...required, ...icons.map((icon) => `assets/scenarios/${icon}.svg`)]) if (!existsSync(join(root, file))) failures.push(`missing ${file}`);
for (const file of ['assets/hero-rail.svg', 'og/railyard-og.svg', ...icons.map((icon) => `assets/scenarios/${icon}.svg`)]) {
  if (!existsSync(join(root, file))) continue;
  const text = readFileSync(join(root, file), 'utf8');
  if (!/<svg\b[^>]*\bviewBox=/.test(text)) failures.push(`no viewBox ${file}`);
}
const pngSize = (file) => { const b = readFileSync(join(root, file)); return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }; };
for (const [file, expected] of [['favicon-16.png', [16, 16]], ['favicon-32.png', [32, 32]], ['apple-touch-icon.png', [180, 180]], ['og/railyard-og.png', [1200, 630]]]) {
  if (!existsSync(join(root, file))) continue;
  const size = pngSize(file);
  if (size.width !== expected[0] || size.height !== expected[1]) failures.push(`wrong dimensions ${file}: ${size.width}x${size.height}`);
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`asset check: ${required.length + icons.length} required assets present; OG 1200x630; favicon 16/32/180px`);
