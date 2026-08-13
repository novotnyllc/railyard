import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import { BASE_PATH, SITE_URL } from './src/config/site.mjs';
import remarkBaseLinks from './src/plugins/remark-base-links.mjs';

export default defineConfig({
  site: SITE_URL,
  base: BASE_PATH,
  trailingSlash: 'always',
  output: 'static',
  markdown: { processor: unified({ remarkPlugins: [[remarkBaseLinks, { base: BASE_PATH }]] }) },
});
