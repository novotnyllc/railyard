# Custom-domain cutover

The first release uses the project Pages base `https://novotnyllc.github.io/railyard/`. The base is intentionally one constant in `site/src/config/site.mjs`.

Run this checklist only after `railyard.express` DNS has propagated and the project site has passed the hosted route receipt:

1. In `site/src/config/site.mjs`, change `BASE_PATH = '/railyard'` to `BASE_PATH = '/'`.
2. Add `site/public/CNAME` containing exactly `railyard.express`.
3. Run `npm ci && npm run build && npm run check:assets && npm run check:links` in `site/`.
4. Commit and push this one-commit cutover to `main` through the normal signed review path.
5. After the commit is on `main`, set the Pages custom domain:

   ```sh
   gh api --method PUT repos/novotnyllc/railyard/pages \
     -H 'Accept: application/vnd.github+json' \
     -f cname='railyard.express' \
     -f build_type='workflow'
   ```

6. Confirm `https://railyard.express/`, its stylesheet, favicon, and OG image return 200. Keep the project URL as a fallback until the registrar NS switch and certificate state are settled.

The cutover intentionally changes one source constant plus the CNAME file. Do not rewrite the Markdown tree or add a runtime adapter.
