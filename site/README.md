# Railyard product site

Astro static marketing and docs site for the Railyard product. The source Markdown under `src/content/pages/` is adapted from the former public site; the landing page and shared shell provide the product presentation.

## Local checks

```sh
npm ci
npm run build
npm run check:assets
npm run check:links
```

`dist/` is build output and is not committed. The committed visual system is SVG-first: a hero rail diagram, ten scenario icons, a favicon family derived from the existing `plugins/railyard/assets/icon.png` rail-switch mark, and a 1200×630 OG composition plus its PNG export. Later bespoke raster art would help most on the hero illustration and OG card, followed by any scenario that needs a richer editorial image.
