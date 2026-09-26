---
name: oracle
description: "Manual Oracle consult: send a scoped prompt and files to GPT-6 Pro through the user's signed-in ChatGPT browser with the `oracle` CLI. Use when the user asks for Oracle or GPT-6 Pro, or a hard design, debugging, or review question needs that model."
---

# Oracle

Oracle (`steipete/oracle`) bundles a prompt and selected files and submits
them to ChatGPT in an automated browser. Its distinctive value is **GPT-6 Pro
on the user's ChatGPT subscription**, which native subagents cannot reach.

Use it when the user asks for Oracle or GPT-6 Pro, or when a hard question
justifies a long Pro consult. For an ordinary second opinion, a native child
is usually enough and easier to coordinate: a Claude subagent on Fable 5.1 or
Opus 5.5, or a Codex child on GPT-6 Astra. For a cross-family opinion, use the
other family's native agent. Oracle is advisory. It is not a review gate, so
return verified findings to whoever owns the review.

## Setup

Resolve `SKILL_DIR` to the directory containing this `SKILL.md`, then run:

```bash
ORACLE_CLI="$(bash "$SKILL_DIR/scripts/ensure-oracle.sh")" || exit $?
```

The helper prints the absolute path of an Oracle executable at version
0.20.3 or newer. It accepts `ORACLE_BIN` when that is an absolute, current
executable. Otherwise it uses or installs the `steipete/tap/oracle` Homebrew
formula, falling back to `npm install --global --prefix "$HOME/.local"`. It
never touches Oracle configuration, sessions, or browser state. If it fails,
report the error instead of trying another binary. Use `"$ORACLE_CLI"` for the
rest of the session. If your shell does not keep variables between calls,
reuse the printed path.

Once per host, or when the user asks, fill in Oracle config defaults:

```bash
node "$SKILL_DIR/scripts/ensure-oracle-config.mjs"
```

This is the only Railyard script that writes Oracle configuration. In
`~/.oracle/config.json` (or `ORACLE_CONFIG_PATH`) it adds only missing keys:
`engine: "browser"`, `sessionRetentionHours: 168`, `browser.manualLogin: true`,
and `browser.headless: true`. It never changes an existing value. If the file
is not a valid JSON object, it exits nonzero and leaves the file unchanged.
Tell the user which keys it reports adding.

With `browser.manualLogin: true`, Oracle reuses one persistent automation
profile. If ChatGPT shows a login or account picker, stop and ask the user to
sign in to that profile; never enter credentials. `--copy-profile` does not
work with manual login. If the user set `browser.headless: false`, run
`node "$SKILL_DIR/scripts/reset-browser-profile.mjs"` before a visible-browser
run. It clears Chrome's crash-restore bubble and any off-screen window
position, and refuses to run while Chrome holds the profile.

## Run a consult

Preview the bundle first. `--dry-run` sends nothing and opens no browser:

```bash
"$ORACLE_CLI" --dry-run summary --files-report \
  --engine browser --model gpt-6-pro \
  --browser-model-strategy select --browser-thinking-time pro \
  --slug "<three to five words>" \
  -p "<briefing and question>" \
  --file "src/feature/**" --file "!**/*.test.*"
```

Then run the same command without `--dry-run summary --files-report`. The
flags select ChatGPT's `Latest` model with Pro thinking. Generic Pro aliases
can map to older models, so keep `gpt-6-pro` and `--browser-thinking-time pro`
explicit. Pro answers can take a long time. The slug gives you a stable handle
for the session.

`--file` accepts files, directories, and globs, and can be repeated. A `!`
prefix excludes. Oracle honors `.gitignore`, skips dotfiles unless the pattern
names them, and rejects files over 1 MB by default. Choose the fewest files
that still contain the answer.

For other flags, including API engines, remote browsers, project sources,
and multi-model runs, see `"$ORACLE_CLI" --help` and
`"$ORACLE_CLI" --help --verbose`. An API run bills the user's API account, so
use one only when the user has authorized it.

## Follow-ups and reattach

If a run detaches or times out, do not submit it again. Reattach with
`"$ORACLE_CLI" session <slug>`, and list recent sessions with
`"$ORACLE_CLI" status --hours 72`. To re-review after changes, continue the
stored conversation with
`"$ORACLE_CLI" --followup <slug> -p "<what changed; what to re-check>"`.
Attach only the changed files. A follow-up is not an independent review. Start
a fresh session when you need independence or have a different question.

## Brief checklist

Oracle starts with no project knowledge. Put these in the prompt:

- Project and stack, with build and test commands.
- Where the relevant code lives, and what each attached file is.
- The exact question, what you already tried, and verbatim error text.
- Constraints, such as APIs that must not change or performance budgets.
- The output you want, such as ranked risks, a patch plan, or options with
  tradeoffs.

## Safety and verification

- Do not attach secrets: `.env` files, keys, tokens, cookies, or credential
  stores. Redact what you can't leave out.
- Keep account identity and credentials out of prompts and notes.
- Oracle can be wrong. Check each finding against the code and the relevant
  tests before you act on it or report it, and label anything you could not
  verify.

See [model compatibility](references/model-compatibility.md) for the checked
Oracle version and model mapping.

Adapted from `steipete/oracle` `skills/oracle` at
`0f0bdb6a752efb2c736ec4dcaa6d3cc29743d851` (MIT).
