---
name: oracle
description: "Optional Oracle specialist consult: bundle a scoped prompt and files for a selected browser or API model. Use for requested second-model advice, debugging, refactoring, or design checks."
---

# Oracle (CLI)

Oracle bundles a scoped question and selected files for an optional specialist
consult through a browser or API. Use it when the question benefits from that
model or the user requests it. It is not a mandatory review stage for ordinary
work. Verify findings against the code and relevant tests, then return them to
the existing review/CI owner; do not start another settlement or watch loop.

## Choose the surface and reasoning setting

Select the reviewer model and effort together for the question. These are
distinct surfaces; the Oracle controls below were checked in **0.20.3**:

| Surface | Model control | Reasoning control | Evidence |
| --- | --- | --- | --- |
| ChatGPT browser | `gpt-6-pro` | `--browser-thinking-time pro` | Verified `Latest` picker selection and Pro thinking in that session |
| OpenAI Responses API | `gpt-6-astra` | `--reasoning-effort max`, plus an explicitly chosen `--reasoning-mode standard` or `pro` | Provider response/receipt; model availability is account-dependent |
| Native Codex reviewer | Current native selector, such as `gpt-6-astra` | Current native `reasoning_effort`, chosen deliberately | Native dispatch evidence; this is not an Oracle route |

Browser Pro is not native Astra `max`. In Oracle 0.20.3 the Astra API adapter
accepts `low`, `medium`, `high`, `xhigh`, and `max`; it does not accept `none`
or `ultra`. Do not copy effort values between surfaces or silently substitute
models. See [model compatibility](references/model-compatibility.md) when
checking a different Oracle version or picker layout.

## Availability (ChatGPT Pro)

The browser path needs a signed-in account with access to the requested
Pro tier. Use an existing availability result only as a planning hint, never
as proof that a new session selected the intended controls.

An optional cache at
`${XDG_CONFIG_HOME:-$HOME/.config}/railyard/oracle-pro.json` may record
`available`, `checkedAt`, `browserModel`, and `thinkingTime`. Reuse it for up
to seven days only when the pair is `gpt-6-pro`/`pro`. An old boolean-only or
Sol cache does not establish this pair. Successful local session metadata and
its own control log can supply evidence without another browser run.

Otherwise the first requested consult is the availability check; do not launch
a throwaway model call. A login/account-selection surface stops without
interaction. A missing or disabled Pro control means that requested run could
not select Pro; a timeout or transient failure does not establish subscription
absence. Keep credentials and account identity out of availability state.

## Routed model-routing mode (policy-selected browser reviews only)

When an active caller supplies an admitted, claimed
`railyard/model-routing/v1` `oracle-browser` review decision, use this
skill's `scripts/oracle-route.mjs` carrier instead of the manual bootstrap
below. It accepts only the `chatgpt_current_pro` channel, uses the versioned
`v2` browser carrier with local Homebrew Oracle `>=0.20.3`, and spawns only
`--engine browser --model gpt-6-pro --browser-model-strategy select
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
  verified `Latest` selection (or Oracle's exact supported localized label)
  and exactly one pre-answer Pro thinking-control record. When
  `thinkingSelection` metadata is present it must also confirm Pro. Missing,
  duplicate, or mismatched required evidence is a named failure receipt and a
  nonzero route CLI exit. Never
  accept model-answer text as picker or effort proof. These receipts attest
  browser UI controls, not backend model identity or native Codex effort.
- A detached session is reattached by the same claim on the same host, never
  redispatched; retries return the existing or an `ambiguous` receipt, never a
  second launch. Frozen Sol bundles and detached Sol sessions are unsupported
  by this carrier revision and are never relabeled as Astra. A login/account
  selection surface stops without interaction.
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

Oracle requires version 0.20.3 or newer for the controls documented here.
`ORACLE_BIN` is an explicit validation-only input override: it must be an
absolute executable at that version or newer; the helper does not replace it.
Otherwise the helper prefers the canonical
`steipete/tap/oracle` Homebrew formula. A current selected package owner is a
no-op. If Homebrew is unavailable, cannot repair its missing or stale formula,
or cannot post-verify the selected formula, the bounded fallback is:

```bash
npm install --global --prefix "$HOME/.local" @steipete/oracle@0.20.3
```

A current stable `~/.local/bin/oracle` avoids repeat Homebrew attempts. The
bootstrap preserves Oracle configuration, authentication, sessions, browser
profiles, cookies, and other browser state.

### Config defaults (owned here, not by a dotfile manager)

Run this once per host, before the first browser run. It is idempotent and
fills in only keys that are ABSENT, so an explicit user value always wins:

```bash
node "$SKILL_DIR/scripts/ensure-oracle-config.mjs"
```

The helper supplies `browser.headless: true` for Oracle's local automation
browser while preserving an explicit user setting. No dotfile manager is
required. Choose a remote `oracle serve` host or `--browser-attach-running`
only when that browser placement is intended; those modes have their own
session and profile requirements and are not a substitute for headless mode.

## Main use case (browser, Latest + Pro thinking)

For a selected browser consult, pass `--engine browser --model gpt-6-pro
--browser-model-strategy select --browser-thinking-time pro`. Oracle 0.20.3
maps that explicit browser alias to the `Latest` model radio and verifies the
requested Pro tier. A stored session may take substantial time; reattach it
rather than resubmitting the prompt.

Use explicit controls rather than a generic Pro alias: older `gpt-5-pro`
aliases still normalize to the Sol picker in Oracle 0.20.3. For API Astra, use
`gpt-6-astra` and the API reasoning flags above; `gpt-6-pro` is a browser
alias, not an API model slug. Read the compatibility reference before choosing
another supported pair. Account access and the selected controls must be
verified for the actual run.

## Browser profile mode (choose one)

Before a browser run, inspect only the presence, JSON type, and boolean value of
the nested `browser.manualLogin` value in `~/.oracle/config.json`; never print
the config, environment, or secrets. Oracle reads this nested key: a top-level
`browserManualLogin` value and the absence of `ORACLE_*` environment variables
do not override it. Oracle rejects `--copy-profile` with manual-login
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

### Before a HEADFUL browser run

```bash
node "$SKILL_DIR/scripts/reset-browser-profile.mjs"
```

Oracle kills its automation Chrome rather than exiting it, so the profile keeps
`exit_type: "Crashed"` and every launch shows the "didn't shut down correctly /
restore tabs" bubble, which can steal focus from the automation. It also
persists `window_placement`, so a window once positioned offscreen stays there.
This clears both, and refuses outright while any process holds the profile —
editing Preferences under a live Chrome is the thing worth avoiding, so an
unknown answer fails closed.

Not needed with `browser.headless: true` (the configured default): there is no
window to place and no bubble to show. Run it when a headful run is
deliberately chosen, or after a run was interrupted.

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

- Browser run (selected specialist consult):
  - `"$ORACLE_CLI" --engine browser --model gpt-6-pro --browser-model-strategy select --browser-thinking-time pro -p "<task>" --file "src/**"`
  - Accept the requested pair only when that session's metadata reports a
    verified `Latest` selection and its own pre-`Answer:` `output.log` has
    exactly one Pro thinking-control record. Any present `thinkingSelection`
    metadata must also confirm the requested Pro tier. Otherwise report the
    observed controls and missing evidence; answer text cannot verify them.

- API Astra run (when paid API use is authorized):
  - `"$ORACLE_CLI" --provider openai --engine api --model gpt-6-astra --reasoning-mode standard --reasoning-effort max -p "<task>" --file "src/**"`
  - Choose `--reasoning-mode pro` only when that API mode is intended; it is
    distinct from browser Pro and from the reasoning effort.

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

- Keep input within the selected model's reported limit; use a scoped bundle.
- Use `--files-report` (and/or `--dry-run json`) to spot the token hogs before spending.
- Use `--perf-trace` / `ORACLE_PERF_TRACE=1` for startup and first-output timing. Traces redact prompts, tokens, keys, cookies, and inline cookie payloads; detached API children write a session-suffixed sidecar trace.
- If you need hidden/advanced knobs: `"$ORACLE_CLI" --help --verbose`.

## Engines (API vs browser)

- Auto-pick: uses `api` when `OPENAI_API_KEY` is set, otherwise `browser`.
- Model and reasoning controls are surface-specific: browser uses
  `gpt-6-pro --browser-model-strategy select --browser-thinking-time pro`;
  API Astra uses `gpt-6-astra` with a supported explicit effort and mode.
- Browser engine supports GPT + Gemini only; use `--engine api` for Claude/Grok/Codex or multi-model runs.
- API runs need authorization for the paid API path. Existing authorization
  in the task counts; do not ask again merely because this skill was opened.
- Browser attachments:
  - `--browser-attachments auto|never|always` (auto pastes inline up to ~60k chars then uploads).
  - Add `--browser-bundle-files --browser-bundle-format auto|zip` to upload many files as one bundle; ZIP bundles preserve original file bytes.
- Remote browser host (signed-in machine runs automation):
  - Host: `"$ORACLE_CLI" serve --host 0.0.0.0 --port 9473 --token <secret>`
  - Client: `"$ORACLE_CLI" --engine browser --remote-host <host:port> --remote-token <secret> -p "<task>" --file "src/**"`

## Follow-ups and independent review

Use a stored-session follow-up when revisiting the same question after a
change. It preserves earlier findings and avoids resending unchanged context.
Use a fresh session when independence or a materially different question
calls for it. A follow-up to the same reviewer is not an independent review.

Two distinct mechanisms; they are not interchangeable:

- **`--followup <sessionId|responseId>`** continues a *stored* session in a
  later run. This is the one for "you reviewed this, here is the revision" —
  the normal re-review loop. Reuse the slug you set on the first run to find
  it, or `oracle status` to list recent sessions.
  - `"$ORACLE_CLI" --followup <sessionId> -p "<what changed and what to re-check>"`
  - Attach only the files that CHANGED. The prior turn is still in context;
    re-sending the unchanged tree is the waste this exists to avoid.
  - `--followup-model <model>` picks which model's response to continue from in
    a multi-model session.

- **`--browser-follow-up <prompt>`** (repeatable) queues additional turns in the
  SAME run, in one ChatGPT conversation. Use it when the turns are known in
  advance — "review this, then propose the diff, then list the risks" — not for
  reacting to what came back.

Set `--slug "<3-5 words>"` on every first-round consult. Without it the session
id is the only handle, and a re-review a day later has nothing memorable to
attach to.

**Never re-run a prompt to "check" a detached or timed-out session.** Reattach
with `oracle session <slug>`; a duplicate prompt is blocked without `--force`
precisely because re-running is almost always the wrong instinct.

## Shared project context

`oracle project-sources` uploads files into a ChatGPT Project's persistent
Sources tab, so recurring consults against a stable codebase stop re-sending
the same tree every time.

- `"$ORACLE_CLI" project-sources list --chatgpt-url <project-url>`
- `"$ORACLE_CLI" project-sources add --chatgpt-url <project-url> --file "src/**"`

Point runs at the project with `--chatgpt-url`. This suits a long-lived repo
reviewed repeatedly; it is not a substitute for `--file` on a one-off consult,
and stale Sources are worse than none — refresh them when the tree moves, or
the model reasons confidently about code that no longer exists.

## API preflight

- API runs incur usage costs; use the already-authorized provider and budget.
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

To reproduce a standalone review, retain the scoped prompt and exact file
revision. For a revision of an existing consult, use its stored-session
follow-up with the changed files as described above.

## Safety

- Don’t attach secrets by default (`.env`, key files, auth tokens). Redact aggressively; share only what’s required.
- Prefer “just enough context”: fewer files + better prompt beats whole-repo dumps.

Adapted from `steipete/oracle` `skills/oracle` at
`0f0bdb6a752efb2c736ec4dcaa6d3cc29743d851` (MIT).
