import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { BASE_PATH } from '../src/config/site.mjs';

const root = resolve(new URL('../dist/', import.meta.url).pathname);
const htmlFiles = [];
function collect(dir) { for (const name of readdirSync(dir, { withFileTypes: true })) { const file = join(dir, name.name); if (name.isDirectory()) collect(file); else if (name.name.endsWith('.html')) htmlFiles.push(file); } }
collect(root);
const idsByFile = new Map(htmlFiles.map((file) => [file, new Set([...readFileSync(file, 'utf8').matchAll(/\bid=["']([^"']+)["']/g)].map((m) => m[1]))]));
const failures = [];
function targetFor(pathname) {
  let path = decodeURIComponent(pathname);
  if (BASE_PATH !== '/' && (path === BASE_PATH || path.startsWith(`${BASE_PATH}/`))) path = path.slice(BASE_PATH.length) || '/';
  if (path.endsWith('/')) path += 'index.html';
  else if (!path.includes('.')) path += '/index.html';
  return join(root, path.replace(/^\//, ''));
}
for (const file of htmlFiles) {
  const source = readFileSync(file, 'utf8');
  for (const match of source.matchAll(/(?:href|src)=["']([^"']+)["']/g)) {
    const value = match[1];
    const [rawPath, fragment] = value.split('#');
    if (!rawPath && fragment) {
      if (!idsByFile.get(file)?.has(fragment)) failures.push(`${relative(root, file)} -> ${value} (missing anchor)`);
      continue;
    }
    if (!value || /^(?:[a-z]+:|\/\/|data:|mailto:|tel:)/i.test(value)) continue;
    if (BASE_PATH !== '/' && rawPath.startsWith('/') && !rawPath.startsWith(`${BASE_PATH}/`)) failures.push(`${relative(root, file)} -> ${value} (missing configured base ${BASE_PATH})`);
    const url = rawPath.startsWith('/') ? new URL(`https://local.test${rawPath}`) : new URL(rawPath, `https://local.test/${relative(root, file)}`);
    const target = targetFor(url.pathname);
    if (!existsSync(target)) failures.push(`${relative(root, file)} -> ${value} (missing ${relative(root, target)})`);
    else if (fragment && target.endsWith('.html') && !idsByFile.get(target)?.has(fragment)) failures.push(`${relative(root, file)} -> ${value} (missing anchor)`);
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log(`link check: ${htmlFiles.length} HTML pages; local links, anchors, and assets resolved`);
