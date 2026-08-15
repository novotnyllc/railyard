---
name: oracle
description: "Oracle second-model review: bundle prompts/files, debug, refactor, design-check."
---

# Oracle (CLI) — best use

Oracle bundles your prompt + selected files into one “one-shot” request so another model can answer with real repo context (API or browser automation). Treat outputs as advisory: verify against the codebase + tests.

## Availability (ChatGPT Pro)

The main browser path requires a signed-in ChatGPT **Pro** account. Check
availability efficiently and cache the answer instead of probing every
activation:

1. Read `${XDG_CONFIG_HOME:-$HOME/.config}/railyard/oracle-pro.json`
   (`{"available": <bool>, "checkedAt": "<ISO-8601>"}`). If it exists and
   `checkedAt` is within 7 days, trust it — available means proceed,
   unavailable means say so and stop offering Oracle.
2. If missing or stale, look for cheap local evidence first: a successful
   `gpt-5.6-sol` browser session whose metadata records
   `resolvedLabel=GPT-5.6 Sol; verified=yes` and whose pre-`Answer:` session
   log has exactly one `[browser] Thinking time: Pro` control record proves
   the supported browser-Pro pair; write the cache and proceed. A
   `gpt-5-pro` browser session is not proof: Oracle 0.17.3 normalizes it to
   the `GPT-5.5` picker target.
3. Otherwise the first real run is the check. Never launch a throwaway browser
   run purely to probe. A login or account-selection surface, or a missing Pro
   picker target, means unavailable: write `available: false` and stop without
   interacting with the login surface.

After any run that changes the answer (login fixed, subscription lapsed),
rewrite the cache. The cache is advisory availability state only — never
credentials or account identity.

## Routed model-routing mode (policy-selected browser reviews only)

When an active caller supplies an admitted, claimed
`railyard/model-routing/v1` `oracle-browser` review decision, use this
skill's `scripts/oracle-route.mjs` carrier instead of the manual bootstrap
below. It accepts only the `chatgpt_current_pro` channel, fixes Oracle to
local Homebrew Oracle `>=0.17.3`, and spawns only
`--engine browser --model gpt-5.6-sol --browser-model-strategy select
--browser-thinking-time pro`. Key invariants, enforced by the script and its
tests rather than by prose:

- It verifies the claimed review and frozen-input digest through
  model-routing's read-only claim inspection before any Oracle or Homebrew
  call; caller-shaped claim JSON is not authority, and settlement receipts go
  only through its private-state importer, so edited JSON cannot forge them.
- It ignores `ORACLE_BIN`, `ORACLE_MODEL`, `ORACLE_HOME_DIR`, caller `PATH`,
  and Homebrew overrides; it validates the executable and its ancestry before
  each spawn.
- It freezes the prompt/file bundle, revalidates its digest before the one
  browser spawn, and keeps review output in a bounded private artifact whose
  receipt exposes only a locator and digest.
- After every completed dispatch or reattach, it reads only the route-owned
  session metadata allowlist plus the pre-`Answer:` control region of that
  session's `output.log`. It accepts the review only when the metadata proves
  verified `GPT-5.6 Sol` selection and exactly one
  `[browser] Thinking time: Pro` record; missing, duplicate, or mismatched
  evidence is a named failure receipt and a nonzero route CLI exit. Never
  accept model-answer text as picker or effort proof.
- A detached session is reattached by the same claim on the same host, never
  redispatched; retries return the existing or an `ambiguous` receipt, never a
  second launch. A login/account-selection surface stops without interaction.
- Install/upgrade is the separate `oracle-homebrew-lifecycle` transaction
  (fixed `steipete/tap/oracle`, no elevation, zero model-usage meters); a
  successful lifecycle requires a fresh review claim afterward.

Routed `oracle-api` is `unsupported_adapter` in v1 and never falls back from
the browser claim. All manual commands below remain outside routed v1.

## Required bootstrap (every activation)

Before the first Oracle command on **every** activation, resolve `SKILL_DIR` as
the absolute directory containing this activated, installed `SKILL.md` (from the
path supplied by Codex or Claude Code). Do not infer it from a plugin cache or
source checkout. Then run this helper exactly once:

```bash
ORACLE_CLI="$(bash "$SKILL_DIR/scripts/ensure-oracle.sh")" || exit $?
```

The helper returns the validated absolute executable path. If it fails, stop
Oracle use: do not invoke a bare `oracle`, try another package command, or
otherwise bypass the failure. Use `"$ORACLE_CLI"` for every later normal Oracle
command in this activation, including help, preflight, remote-browser, and
session commands. Agents whose shell variables do not persist between tool
calls must retain the returned absolute path and substitute it literally in
later Oracle commands.

Oracle requires version 0.17.3 or newer. `ORACLE_BIN` is only an explicit
validation-only input override: it must be an absolute executable at that
version or newer; the helper does not replace it. Otherwise the helper prefers the canonical
`steipete/tap/oracle` Homebrew formula. A current selected package owner is a
no-op. If Homebrew is unavailable, cannot repair its missing or stale formula,
or cannot post-verify the selected formula, the bounded fallback is:

```bash
npm install --global --prefix "$HOME/.local" @steipete/oracle@0.17.3
```

A current stable `~/.local/bin/oracle` avoids repeat Homebrew attempts. The
bootstrap preserves Oracle configuration, authentication, sessions, browser
profiles, cookies, and other browser state.

## Main use case (browser, GPT-5.6 Sol + Pro thinking)

Default workflow here: `--engine browser` with the user's preferred signed-in reasoning model. This is the “human in the loop” path: it can take ~10 minutes to ~1 hour; expect a stored session you can reattach to.

Recommended defaults:
- Engine: browser (`--engine browser`)
- Browser Pro: `${ORACLE_MODEL:-gpt-5.6-sol}` with
  `--browser-model-strategy select --browser-thinking-time pro` selects
  `GPT-5.6 Sol` and requests the verified Pro-thinking tier
- Browser base Sol: `--model gpt-5.6-sol --browser-thinking-time heavy`
- API Pro: `--model gpt-5.6-sol --reasoning-mode pro --reasoning-effort max`
- Attachments: directories/globs + excludes; avoid secrets.

Oracle 0.17.3 or newer is required for this browser-Pro pair. Pro is not a
separate browser or API model slug: `gpt-5.6-pro` and `gpt-5.6-sol-pro` are
invalid. Oracle 0.17.3 exposes no browser flag that deterministically targets
an unnamed newer Pro picker label; its `gpt-5-pro` alias normalizes to
`gpt-5.5-pro` and the `GPT-5.5` picker. Browser mode therefore uses
`gpt-5.6-sol` plus Pro thinking and requires the observed pair below; API mode
uses `gpt-5.6-sol` plus the Pro reasoning flags above. GPT-5.6 availability
remains account-dependent.

## Browser profile mode (choose one)

Before a browser run, inspect only the presence, JSON type, and boolean value of
the nested `browser.manualLogin` value in `~/.oracle/config.json`; never print
the config, environment, or secrets. Oracle reads this nested key: a top-level
`browserManualLogin` value and the absence of `ORACLE_*` environment variables
do not override it. Oracle 0.17.0 rejects `--copy-profile` with manual-login
mode.

Run this read-only Node stdlib probe; it prints only the non-secret
classification `browser.manualLogin=missing|true|false|invalid`:

```bash
node <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

let state = "missing";
try {
  const config = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".oracle", "config.json"), "utf8"));
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    state = "invalid";
  } else {
    const browser = config.browser;
    if (browser === undefined) {
      state = "missing";
    } else if (!browser || typeof browser !== "object" || Array.isArray(browser)) {
      state = "invalid";
    } else if (browser.manualLogin === undefined) {
      state = "missing";
    } else if (typeof browser.manualLogin === "boolean") {
      state = String(browser.manualLogin);
    } else {
      state = "invalid";
    }
  }
} catch (error) {
  state = error && error.code === "ENOENT" ? "missing" : "invalid";
}
process.stdout.write(`browser.manualLogin=${state}\n`);
NODE
```

- **Persistent manual-login:** when the probe prints `true`,
  omit `--copy-profile` and use the configured manual-login profile.
- **Copied profile:** use `--copy-profile` only after the user deliberately
  sets nested `browser.manualLogin` to `false` in their own configuration.
- **Missing or invalid:** ask the user which profile mode to use. Never edit
  configuration or authentication state automatically.

An unsigned-in private browser profile is an authentication state, not a
bootstrap failure.

## Golden path (fast + reliable)

1. Pick a tight file set (fewest files that still contain the truth).
2. Preview what you’re about to send (`--dry-run` + `--files-report` when needed).
3. Run in browser mode for the user's preferred signed-in model; use API only when you explicitly want it.
4. If the run detaches/timeouts: reattach to the stored session (don’t re-run).

## Commands (preferred)

- Show help (once/session):
  - `"$ORACLE_CLI" --help --verbose`

- Preview (no tokens):
  - `"$ORACLE_CLI" --dry-run summary -p "<task>" --file "src/**" --file "!**/*.test.*"`
  - `"$ORACLE_CLI" --dry-run full -p "<task>" --file "src/**"`

- Token/cost sanity:
  - `"$ORACLE_CLI" --dry-run summary --files-report -p "<task>" --file "src/**"`

- Startup/perf trace:
  - `"$ORACLE_CLI" --perf-trace --perf-trace-path /tmp/oracle-perf.json --dry-run summary -p "<task>" --file "src/**"`
  - Use when CLI startup or time-to-first-output feels slow; inspect `first-output` and `exit`.

- Browser run (main path; long-running is normal):
  - `"$ORACLE_CLI" --engine browser --model "${ORACLE_MODEL:-gpt-5.6-sol}" --browser-model-strategy select --browser-thinking-time pro -p "<task>" --file "src/**"`
  - For a Browser-Pro run, `ORACLE_MODEL` must resolve to `gpt-5.6-sol`.
    After completion, accept it only when its session metadata reports
    verified `GPT-5.6 Sol` and its own pre-`Answer:` `output.log` has exactly
    one `[browser] Thinking time: Pro` line. Otherwise stop and report the
    observed picker state; do not silently accept a downgrade or use answer
    text as evidence.

- API Pro run (only after explicit cost consent):
  - `"$ORACLE_CLI" --engine api --model gpt-5.6-sol --reasoning-mode pro --reasoning-effort max -p "<task>" --file "src/**"`

- Manual paste fallback (assemble bundle, copy to clipboard):
  - `"$ORACLE_CLI" --render --copy -p "<task>" --file "src/**"`
  - Note: `--copy` is a hidden alias for `--copy-markdown`.

## Attaching files (`--file`)

`--file` accepts files, directories, and globs. You can pass it multiple times; entries can be comma-separated.

- Include:
  - `--file "src/**"` (directory glob)
  - `--file src/index.ts` (literal file)
  - `--file docs --file README.md` (literal directory + file)

- Exclude (prefix with `!`):
  - `--file "src/**" --file "!src/**/*.test.ts" --file "!**/*.snap"`

- Defaults (important behavior from the implementation):
  - Default-ignored dirs: `node_modules`, `dist`, `coverage`, `.git`, `.turbo`, `.next`, `build`, `tmp` (skipped unless you explicitly pass them as literal dirs/files).
  - Honors `.gitignore` when expanding globs.
  - Does not follow symlinks (glob expansion uses `followSymbolicLinks: false`).
  - Dotfiles are filtered unless you explicitly opt in with a pattern that includes a dot-segment (e.g. `--file ".github/**"`).
  - Default cap: files > 1 MB are rejected unless you raise `ORACLE_MAX_FILE_SIZE_BYTES` or `maxFileSizeBytes` in `~/.oracle/config.json`.

## Budget + observability

- Target: keep total input under ~196k tokens.
- Use `--files-report` (and/or `--dry-run json`) to spot the token hogs before spending.
- Use `--perf-trace` / `ORACLE_PERF_TRACE=1` for startup and first-output timing. Traces redact prompts, tokens, keys, cookies, and inline cookie payloads; detached API children write a session-suffixed sidecar trace.
- If you need hidden/advanced knobs: `"$ORACLE_CLI" --help --verbose`.

## Engines (API vs browser)

- Auto-pick: uses `api` when `OPENAI_API_KEY` is set, otherwise `browser`.
- GPT-5.6 Pro effort is surface-specific: browser uses
  `gpt-5.6-sol --browser-model-strategy select --browser-thinking-time pro`
  with the required observed-model assertion; API uses
  `gpt-5.6-sol --reasoning-mode pro`.
- Browser engine supports GPT + Gemini only; use `--engine api` for Claude/Grok/Codex or multi-model runs.
- **API runs require explicit user consent** before starting because they incur usage costs.
- Browser attachments:
  - `--browser-attachments auto|never|always` (auto pastes inline up to ~60k chars then uploads).
  - Add `--browser-bundle-files --browser-bundle-format auto|zip` to upload many files as one bundle; ZIP bundles preserve original file bytes.
- Remote browser host (signed-in machine runs automation):
  - Host: `"$ORACLE_CLI" serve --host 0.0.0.0 --port 9473 --token <secret>`
  - Client: `"$ORACLE_CLI" --engine browser --remote-host <host:port> --remote-token <secret> -p "<task>" --file "src/**"`

## API preflight

- API runs require explicit user consent and cost money.
- Before API runs, check provider readiness without printing secrets:
  - `"$ORACLE_CLI" doctor --providers --models "${ORACLE_MODELS:-<models>}"`
  - `"$ORACLE_CLI" --preflight --models "${ORACLE_MODELS:-<models>}"`
  - `"$ORACLE_CLI" --route --model "${ORACLE_MODEL:-<model>}"`
- If the user wants first-party OpenAI, pass `--provider openai` or `--no-azure`. This prevents exported Azure env/config from hijacking the route:
  - `"$ORACLE_CLI" --provider openai --engine api --model "${ORACLE_MODEL:-<model>}" ...`
- For advisory multi-model panels where partial success is useful, use `--allow-partial --write-output <path>` so successful model files and the `<stem>.oracle.json` manifest are easy to recover:
  - `"$ORACLE_CLI" --models "${ORACLE_MODELS:-<models>}" --allow-partial --write-output /tmp/panel.md -p "<task>"`
- `--timeout 10m` is the normal user-facing API deadline; Oracle derives the HTTP transport timeout unless `--http-timeout` is explicitly set.
- If the exported `OPENAI_API_KEY` is invalid and the user wants a personal OpenAI key, use the `agent-utilities:one-password` skill` in one persistent tmux session with the user-provided item and field. Inject only into the single Oracle command; never print the key.
- For debugging Oracle itself, use the checkout path supplied by the user or `${ORACLE_REPO:-$HOME/dev/oracle}`:
  - `pnpm -C "${ORACLE_REPO:-$HOME/dev/oracle}" run build`
  - `node "${ORACLE_REPO:-$HOME/dev/oracle}/dist/scripts/run-cli.js" ...`

## Sessions + slugs (don’t lose work)

- Stored under `~/.oracle/sessions` (override with `ORACLE_HOME_DIR`).
- Browser runs save durable files under `~/.oracle/sessions/<id>/artifacts/`, including `transcript.md`, Deep Research reports, and downloaded ChatGPT-generated images when available.
- Runs may detach or take a long time. If the CLI times out: don’t re-run; reattach.
  - List: `"$ORACLE_CLI" status --hours 72`
  - Attach: `"$ORACLE_CLI" session <id> --render`
- Use `--slug "<3-5 words>"` to keep session IDs readable.
- Duplicate prompt guard exists; use `--force` only when you truly want a fresh run.
- CLI guardrails: root runs without a prompt exit nonzero; `--dry-run` conflicts with `--render` / `--render-markdown`; Ctrl-C exits foreground API runs with code 130 while browser cleanup/reattach still runs.

## Prompt template (high signal)

Oracle starts with **zero** project knowledge. Assume the model cannot infer your stack, build tooling, conventions, or “obvious” paths. Include:
- Project briefing (stack + build/test commands + platform constraints).
- “Where things live” (key directories, entrypoints, config files, dependency boundaries).
- Exact question + what you tried + the error text (verbatim).
- Constraints (“don’t change X”, “must keep public API”, “perf budget”, etc).
- Desired output (“return patch plan + tests”, “list risky assumptions”, “give 3 options with tradeoffs”).

### “Exhaustive prompt” pattern (for later restoration)

When you know this will be a long investigation, write a prompt that can stand alone later:
- Top: 6–30 sentence project briefing + current goal.
- Middle: concrete repro steps + exact errors + what you already tried.
- Bottom: attach *all* context files needed so a fresh model can fully understand (entrypoints, configs, key modules, docs).

If you need to reproduce the same context later, re-run with the same prompt + `--file …` set (Oracle runs are one-shot; the model doesn’t remember prior runs).

## Safety

- Don’t attach secrets by default (`.env`, key files, auth tokens). Redact aggressively; share only what’s required.
- Prefer “just enough context”: fewer files + better prompt beats whole-repo dumps.

Adapted from `steipete/oracle` `skills/oracle` at
`0f0bdb6a752efb2c736ec4dcaa6d3cc29743d851` (MIT).
