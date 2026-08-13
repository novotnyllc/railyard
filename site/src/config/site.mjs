// Cutover: change this one value to '/' and add public/CNAME.
export const BASE_PATH = '/railyard';
export const SITE_ORIGIN = BASE_PATH === '/' ? 'https://railyard.express' : 'https://novotnyllc.github.io';
export const SITE_URL = `${SITE_ORIGIN}${BASE_PATH === '/' ? '' : BASE_PATH}`;
export const SITE_NAME = 'Railyard';
export const SITE_DESCRIPTION = 'The delivery system for agent work.';

export function withBase(path = '/') {
  if (/^(?:[a-z]+:)?\/\//i.test(path) || path.startsWith('mailto:')) return path;
  const clean = `/${String(path).replace(/^\/+/, '')}`;
  return BASE_PATH === '/' ? clean : `${BASE_PATH}${clean}`;
}
