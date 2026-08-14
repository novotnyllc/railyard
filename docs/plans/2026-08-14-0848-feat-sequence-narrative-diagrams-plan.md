---
artifact_contract: ce-unified-plan/v1
artifact_readiness: implementation-ready
execution: code
date: 2026-08-14
title: "feat: narrative stage 2 sequence-narrative diagrams"
---

# Narrative stage 2: sequence-narrative diagrams

## Problem and outcome

Stage 1 established the site's run-capsule prose. Stage 2 makes the existing
M1-M10 mechanism diagrams readable as single runs: a reader starts at step 1,
follows numbered points on the picture, and matches each number to the ordered
caption list immediately below it. The diagram subjects, URLs, navigation, and
stage-1 narrative remain unchanged.

## Scope

Change only:

- the ten adjacent Mermaid sources under `site/src/diagrams/`;
- the ten committed SVGs under `site/public/diagrams/`;
- the ten page sections that already show those diagrams, adding numbered
  caption lists and no new information architecture;
- the smallest executable parity and SVG-text contrast checks needed to prove
  the new form;
- the site package scripts needed to run those checks.

Do not change navigation, page ordering, landing information architecture,
plugin manifests, runtime loading, or social-posting surfaces. Preserve the
existing stage-1 prose and unrelated worktree state.

## Ordered diagram map

The implementation follows the Oracle diagram lane in this order:

1. M2 delivery lifecycle — `site/src/content/pages/delivery/lifecycle.md`
2. M6 review gates — `site/src/content/pages/delivery/gates.md`
3. M5 model routing — `site/src/content/pages/delivery/model-routing/index.md`
4. M1 convergence — `site/src/content/pages/roundhouse/convergence.md`
5. M7 skill sync — `site/src/content/pages/sync/index.md`
6. M8 canary evidence — `site/src/content/pages/roundhouse/security/canary-evidence.md`
7. M3 trust ratchet — `site/src/content/pages/roundhouse/security/trust-ratchet.md`
8. M10 anti-rollback — `site/src/content/pages/roundhouse/security/anti-rollback.md`
9. M9 enrollment — `site/src/content/pages/roundhouse/security/enrollment-and-tofu.md`
10. M4 trust boundaries with attack-shape overlays —
    `site/src/content/pages/roundhouse/security/attack-shapes.md`

## Design decisions

- Keep the current geometric flat-vector language, palette, rail/signal
  structure, and existing diagram dimensions where possible. Mechanism labels
  remain primary; rail motifs remain structural accents.
- Put the step number at the corresponding node, decision, loop return, or
  hold/apply exit. Use the same sequence number in the adjacent ordered list.
- Give each diagram one protagonist and one terminal receipt/hold outcome.
  M6 retains its return loop; M8 retains explicit apply versus `canary-silent`;
  M10 retains adopt versus hold/re-root; M4 shows each requested attack path,
  the stopping gate, and the residual rather than implying prevention.
- Keep `title` and `desc` in every SVG. Check both light and dark media rules
  against the actual surface colors used by diagram text; do not rely on the
  site's HTML contrast check alone.
- Treat the Mermaid sources as the canonical sequence description and update
  each SVG to the same numbered labels and paths. No runtime Mermaid loader is
  introduced.

## Implementation units

### Diagram/source and page pairs

For each map entry above, update the matching `.mmd`, `.svg`, and page prose.
The page change is one short ordered caption list below the existing image; its
number of items and labels must equal the diagram's numbered sequence. M4's
list names the attempted stolen-key, replay/downgrade, and hub-credential paths,
their gates, and residuals.

### Checks

- Add `site/scripts/check-diagram-sequences.mjs` to parse the ten Mermaid/SVG
  pairs and their page lists, assert one-to-one step numbers and labels, assert
  M4 attack/gate/residual markers, and fail on a missing title/desc or duplicate
  step number.
- Extend `site/scripts/check-contrast.mjs` with the diagram text inventory so
  the existing 52-pair report includes both schemes and the actual `.label` and
  `.small` text/background combinations used by the SVGs. Keep the floor at
  4.5:1 and print a compact diagram-text sweep table.
- Add a package script for the parity check; keep `build`, `check:assets`,
  `check:links`, and the existing contrast command intact.

## Verification

1. Run the focused parity check after all ten page/source/SVG pairs are frozen.
2. Run the extended contrast command and retain the light/dark diagram rows.
3. Run `npm run build`, `npm run check:assets`, and `npm run check:links` once
   against the final batch; do not rerun unchanged gates.
4. Render or inspect representative light and dark output for M2, M7, and M4,
   then spot-check one delivery, one sync, and one security page in the built
   site. Confirm no runtime CDN references.
5. Review the final diff for exactly the scoped pages and assets. Sign the
   commit, open one PR with the requested title, settle every review thread,
   squash-merge on green, prove ancestry, deploy, and live-check three diagram
   pages before cleanup.

## Acceptance evidence

- Ten before/after summaries tied to the ordered map.
- Parity check output showing every diagram's numbered labels equal its page
  caption list exactly.
- Light/dark SVG-text contrast table with no value below 4.5:1.
- Build/assets/links green and both-scheme visual receipts.
- One settled PR, squash merge SHA, ancestry proof, deploy receipt, and three
  live diagram-page receipts.
- Any routing, signing, review, CI, deploy, or live-check deviation reported;
  no guard bypass or synthetic evidence.
