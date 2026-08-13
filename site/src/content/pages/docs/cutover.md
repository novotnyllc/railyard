---
layout: default
title: Custom-domain cutover
nav_order: 1
parent: Start here
---

# Custom-domain cutover

Cut a documentation domain over as one observable handoff: prepare the source, ship one signed commit, then bind Pages after DNS is ready. This keeps content stable, makes rollback reasoning straightforward, and confines the operator action to the domain boundary. The project site serves from `https://novotnyllc.github.io/railyard/` until DNS for `railyard.express` has propagated; the Astro source keeps the move deliberately small.

## The one-commit handoff

1. Change `BASE_PATH = '/railyard'` to `BASE_PATH = '/'` in `site/src/config/site.mjs`.
2. Add `site/public/CNAME` containing `railyard.express`.
3. Build and run the local asset and link receipts.
4. After that signed commit reaches `main`, set the Pages custom domain:

   ```sh
   gh api --method PUT repos/novotnyllc/railyard/pages \
     -H 'Accept: application/vnd.github+json' \
     -f cname='railyard.express' \
     -f build_type='workflow'
   ```

## Why the content stays stable

Keep content independent from deployment location. Markdown links are rewritten at build time from the single base constant, so the page content, navigation, and generated routes do not need a second migration. DNS and certificate state remain operator-controlled.
