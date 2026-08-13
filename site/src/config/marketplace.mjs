import { readFile } from 'node:fs/promises';

const MARKETPLACE_URL = 'https://raw.githubusercontent.com/novotnyllc/marketplace/main/.claude-plugin/marketplace.json';
const FALLBACK_VERSIONS = Object.freeze({ railyard: '0.7.0', roundhouse: '0.7.4' });
let versionsPromise;

function versionsFromCatalog(catalog) {
  const entries = Array.isArray(catalog?.plugins) ? catalog.plugins : [];
  const versions = { ...FALLBACK_VERSIONS };
  for (const entry of entries) {
    if (entry?.name === 'railyard' || entry?.name === 'roundhouse') {
      const version = entry.version || entry.source?.version;
      if (typeof version === 'string' && version.length > 0) versions[entry.name] = version;
    }
  }
  return versions;
}

async function loadCatalog() {
  const catalogPath = process.env.RAILYARD_MARKETPLACE_JSON_PATH;
  if (catalogPath) return JSON.parse(await readFile(catalogPath, 'utf8'));

  try {
    const response = await fetch(MARKETPLACE_URL, { signal: AbortSignal.timeout(1500) });
    if (response.ok) return response.json();
  } catch {
    // The last verified catalog values keep an offline build deterministic.
  }
  return null;
}

export function getMarketplaceVersions() {
  versionsPromise ??= loadCatalog().then(versionsFromCatalog);
  return versionsPromise;
}
