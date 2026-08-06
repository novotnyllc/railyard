<!-- cross-repo links use site-absolute paths, resolved at site build -->

# Oracle

Oracle bundles a prompt plus a chosen set of files into one request and sends it to a second
model with real repository context — either through the ChatGPT Pro browser or, when explicitly
consented, through an API call. It's a second opinion with your actual code attached, not a
general chat window. Treat every answer as advisory: verify it against the codebase and your
tests before acting on it.

## When to use it

- You want a second model's take on a debugging problem, a refactor, or a design question, with
  your actual files attached.
- A routed review decision has selected Oracle as the reviewer — in that case a caller invokes
  this skill's routed carrier automatically; you don't drive the CLI by hand.
- You have ChatGPT Pro and want to use it for a long, careful review that can run from ten
  minutes to an hour, checkpointed as a session you can walk away from and reattach to.

Don't reach for Oracle for something quick a model already knows the answer to — it's built for
"attach the real code and think hard," not fast lookups.

## How it works

### Bootstrap runs once per activation

Before the first Oracle command in a session, the skill resolves the exact directory containing
its own activated `SKILL.md` and runs a bootstrap helper exactly once:

```bash
ORACLE_CLI="$(bash "$SKILL_DIR/scripts/ensure-oracle.sh")" || exit $?
```

That returns a validated absolute path to the Oracle executable — every later command in the
session uses `"$ORACLE_CLI"` literally rather than a bare `oracle`. If the helper fails, Oracle
use stops entirely for that activation rather than falling back to some other invocation. Oracle
0.17.0 or newer is required; the helper prefers the canonical `steipete/tap/oracle` Homebrew
formula, and only falls back to `npm install --global --prefix "$HOME/.local"
@steipete/oracle@0.17.0` if Homebrew can't provide or verify it. The bootstrap never touches
existing Oracle configuration, authentication, sessions, or browser profiles.

### Availability is checked and cached, not probed every time

The main path needs a signed-in ChatGPT Pro account. Rather than probing on every activation,
availability is read from a cache at
`${XDG_CONFIG_HOME:-$HOME/.config}/railyard/oracle-pro.json` (`{"available": bool, "checkedAt":
ISO-8601}`) — trusted as-is if it's less than 7 days old. If it's missing or stale, cheap local
evidence is checked first (a prior successful `gpt-5-pro` browser session in `oracle status
--hours 720`); only if that's inconclusive does the first real run become the check itself —
never a throwaway browser session launched purely to test availability. A login screen, account
picker, or missing Pro option means unavailable: the cache gets written as `false` and Oracle
stops offering itself without interacting with the login screen.

### Two ways to run it

**Manual, everyday use.** You (or the calling workflow) pick a tight file set, preview the token
cost, and run in browser mode:

```bash
"$ORACLE_CLI" --dry-run summary -p "<task>" --file "src/**" --file "!**/*.test.*"
"$ORACLE_CLI" --engine browser --model "${ORACLE_MODEL:-gpt-5-pro}" -p "<task>" --file "src/**"
```

Browser mode is the default "human in the loop" path: `gpt-5-pro` selects ChatGPT's current Pro
picker target. API mode (`--engine api --model gpt-5.6-sol --reasoning-mode pro
--reasoning-effort max`) needs your explicit consent first because it incurs usage costs
directly — it's not the default. Browser mode supports GPT and Gemini only; anything else
(Claude, Grok, Codex, multi-model panels) needs `--engine api`.

**Routed mode, for a policy-selected review.** When a caller holds an admitted, claimed
`railyard/model-routing/v1` `oracle-browser` decision (see
[model-routing.md](./model-routing.md)), it uses this skill's `oracle-route.mjs` carrier instead
of the manual bootstrap. That carrier accepts only the `chatgpt_current_pro` channel, is fixed
to local Homebrew Oracle 0.17.0+, and spawns only `--engine browser --model gpt-5-pro`. It
verifies the claimed review and the frozen-input digest through model routing's own claim
inspection before touching Oracle at all, ignores every `ORACLE_*` override and caller `PATH`,
freezes the prompt/file bundle and revalidates its digest before the one browser spawn, and
reattaches a detached session by the same claim rather than redispatching — a retry never opens
a second browser session. `oracle-api` is not supported in routed mode; it never silently falls
back to it. Install/upgrade through this path is a fully separate transaction
(`oracle-homebrew-lifecycle`) that doesn't consume any model-usage budget.

### Attaching files

`--file` accepts files, directories, and globs, repeatable and comma-separable. Prefix an entry
with `!` to exclude it: `--file "src/**" --file "!src/**/*.test.ts"`. By default,
`node_modules`, `dist`, `coverage`, `.git`, `.turbo`, `.next`, `build`, and `tmp` are skipped
unless passed explicitly as literal paths; `.gitignore` is honored; symlinks aren't followed;
dotfiles are filtered out unless the pattern explicitly includes a dot segment; and files over 1
MB are rejected unless you raise `ORACLE_MAX_FILE_SIZE_BYTES`.

### Budget and sessions

Target keeping total input under roughly 196k tokens — `--files-report` or `--dry-run json`
shows the token hogs before you spend anything. Runs are checkpointed under
`~/.oracle/sessions`; a detached or timed-out run should be reattached (`oracle session <id>
--render`), never re-run, since duplicate-prompt detection exists specifically to prevent
accidental reruns. `--slug "<3-5 words>"` keeps session IDs readable.

### Browser profile mode

Before a browser run, the skill inspects only the presence and value of the nested
`browser.manualLogin` key in `~/.oracle/config.json` — never prints the config or any secret. If
it's `true`, the persistent manual-login profile is used and `--copy-profile` is omitted. If the
user has deliberately set it to `false`, `--copy-profile` is used instead. If it's missing or
invalid, the skill asks which mode to use rather than guessing or editing the config itself.

## Boundaries

- Oracle output is advisory. Every answer gets verified against the actual codebase and tests
  before it's acted on — Oracle never runs code or makes changes itself.
- API runs cost real money and always need your explicit consent before the first call; browser
  runs don't skip this by defaulting to API silently.
- Secrets are never attached by default — `.env` files, key files, auth tokens are excluded; the
  rule of thumb is fewer files and a better prompt over a whole-repo dump.
- Routed mode is narrower than manual mode on purpose: one channel (`chatgpt_current_pro`), one
  engine/model pair, no environment overrides, no redispatch of a detached session.

## Example session

**Prompt:** "Get Oracle's take on why this cache invalidation logic keeps missing edge cases —
attach the cache module and its tests."

**What happens:** The skill resolves `SKILL_DIR`, runs the bootstrap once, and confirms the
Oracle Pro cache is fresh (checked within the last 7 days). It previews the file set with
`--dry-run summary --files-report -p "<task>" --file "src/cache/**" --file
"src/cache/**/*.test.*"` to sanity-check token cost, then runs `--engine browser --model
gpt-5-pro -p "<task>" --file "src/cache/**"`. The run takes several minutes; if it detaches, the
session is reattached with `oracle session <id> --render` rather than restarted. The transcript
and any generated artifacts land under `~/.oracle/sessions/<id>/artifacts/`, and the findings
get checked against the actual test suite before anything changes.

