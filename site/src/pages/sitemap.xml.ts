import { getCollection } from 'astro:content';
import { routeFromId } from '../lib/nav.mjs';
import { SITE_URL } from '../config/site.mjs';

export async function GET() {
  const entries = await getCollection('pages');
  const urls = [`${SITE_URL}/`, ...entries
    .map((entry) => `${SITE_URL}${routeFromId(entry.id)}`)]
    .sort()
    .map((url) => `  <url><loc>${url}</loc></url>`)
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
}
