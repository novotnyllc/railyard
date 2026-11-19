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
    '/delivery/model-routing': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/skills/model-routing': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/skills/jev': { status: 301, destination: '/skills/' },
    '/what-it-does/control-model-cost': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/delivery/audit': { status: 301, destination: '/troubleshooting/' },
    '/skills/audit': { status: 301, destination: '/troubleshooting/' },
    '/skills/oracle': { status: 301, destination: 'https://github.com/novotnyllc/agent-utilities/tree/main/plugins/agent-utilities/skills/oracle' },
    '/skills/cleanup-codex': { status: 301, destination: 'https://github.com/novotnyllc/agent-utilities/tree/main/plugins/agent-utilities/skills/cleanup-codex' },
    '/delivery/routing': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/delivery/model-routing/budgets': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/delivery/model-routing/learning': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/delivery/model-routing/policy': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/delivery/model-routing/tiers': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/delivery/model-routing/worked-runs': { status: 301, destination: '/what-it-does/work-across-harnesses/' },
    '/desired-state/in-fleet': { status: 301, destination: '/roundhouse/store/' },
    '/integrations/unifi/': '/integrations/',
    '/skills/unifi-network-api/': '/skills/',
  },
  markdown: { processor: unified({ remarkPlugins: [[remarkBaseLinks, { base: BASE_PATH }]] }) },
});
