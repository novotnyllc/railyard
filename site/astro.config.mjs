import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import { BASE_PATH, SITE_URL } from './src/config/site.mjs';
import remarkBaseLinks from './src/plugins/remark-base-links.mjs';

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH,
  trailingSlash: 'always',
  output: 'static',
  redirects: {
    '/fleet/store': { status: 301, destination: '/roundhouse/store/' },
    '/fleet/convergence': { status: 301, destination: '/roundhouse/convergence/' },
    '/fleet/operating': { status: 301, destination: '/roundhouse/operating/' },
    '/fleet/config': { status: 301, destination: '/roundhouse/store/' },
    '/fleet/trust': { status: 301, destination: '/roundhouse/security/trust-ratchet/' },
    '/fleet/why-jj': { status: 301, destination: '/roundhouse/store/' },
    '/security/threat-model': { status: 301, destination: '/roundhouse/security/attack-shapes/' },
    '/delivery/routing': { status: 301, destination: '/delivery/model-routing/' },
    '/desired-state/in-fleet': { status: 301, destination: '/roundhouse/store/' },
  },
  markdown: { processor: unified({ remarkPlugins: [[remarkBaseLinks, { base: BASE_PATH }]] }) },
});
