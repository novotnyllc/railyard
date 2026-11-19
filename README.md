<img src="docs/assets/railyard.png" alt="Railyard" width="140" align="right"/>

# Railyard

For authorized repository work, a plain implementation, fix, or open-PR
request runs through review, CI, confirmed merge, and any required release or
deployment and consumer verification. Say “PR only” or “no merge” to stop at
publication. Required approvals and repository holds take precedence.
Compound Engineering (CE) coordinates implementation, PR feedback, and CI.
Railyard also provides specialist review and remote fleet placement.

## One coordinator, different implementers

Describe the outcome in your Codex or Claude Code chat. For example, “Fix
retries and show a useful CLI error when they run out.” Within Deliver,
the chat can handle a small fix directly or select CE Work for a larger
implementation. When CE Work runs, the chat coordinates independent work,
integrates changes, and runs the checks. CE Work defaults to the current
harness.

CE Work uses one external engine per run. The coordinator can give separate
assignments to different engines and isolate concurrent writers. For Groq-hosted
models, use the OpenCode route with a configured `groq/<model-id>`.
[Groq's OpenCode guide](https://console.groq.com/docs/coding-with-groq/opencode)

Set standing implementer preferences in the repository’s
`.compound-engineering/config.yaml` or override them for your checkout in
`.compound-engineering/config.local.yaml`. You can also name an implementer in
the chat. Use an installed, authenticated
engine. If authorship is a requirement, have the coordinator preflight the
engine before starting and verify the actual author in CE’s run record before
accepting the result. CE can fall back to the current host even in
`require` mode. See the
[CE implementation routing guide](https://everyinc.github.io/compound-engineering-plugin/guides/configuration/#implementation-routing).

Use Railyard orchestration when the assignment needs a specific remote
machine or account. Roundhouse supplies the host readiness checks.

```sh
claude plugin marketplace add novotnyllc/marketplace
claude plugin install railyard@novotnyllc
# then just say: "set up railyard"
```

(Codex: `codex plugin marketplace add novotnyllc/marketplace` and
`codex plugin add railyard --marketplace novotnyllc`.)

**Read the [public documentation](https://novotnyllc.github.io/railyard/)** — what it
can do, how it works, and what a delivery actually looks like.

## What's inside

| Track | Skills |
| --- | --- |
| Setup & health | `setup` — inspect and configure relevant prerequisites; `doctor` — diagnose and fix drift; `config` — per-repository settings |
| Delivery | `deliver` — select native execution or one useful CE workflow and complete the authorized scope |
| Orchestration & placement | `orchestrate` — explicit fleet/account work, cross-project coordination, and supported remote placement |
| Specialist review | `thermos`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review` — when their perspective is useful |

## Selected Compound Engineering workflows

Railyard uses the external
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
plugin (3.38.2 or newer) for selected `ce-*` workflows. Use `ce-commit-push-pr` when creating a
PR or pushing user-requested commits to an existing PR. The selected CE
workflow owns PR feedback resolution, CI, and the watch loop. Use the
repository's merge process and confirm the PR landed. Railyard's startup hook
loads delivery and review guidance. Configure required merge checks and
default-branch push restrictions in the repository host.

Railyard defaults to one independent review of the cumulative change before
the first push, then focused review of subsequent repairs and their affected
behavior. Repeat broad review when design or risk changes materially or prior
coverage is uncertain. Choose LFG for work that benefits from a full workflow.
Startup performs no dependency bootstrap. Install CE through the plugin manager
when needed:

```sh
claude plugin marketplace add EveryInc/compound-engineering-plugin
claude plugin install compound-engineering@compound-engineering-plugin
```

## Per-repository settings

Each repository can tune Railyard in its own git config, so the settings cover
every worktree, are never committed, and don't follow a clone. Ask an agent
("turn Railyard off here", "use light reviews in this repo"); the
`railyard:config` skill applies it. By hand, from inside the repository:

```sh
git config railyard.off "$(git rev-parse --path-format=absolute --git-common-dir)"   # off; --unset railyard.off for on
git config railyard.review light     # full | light | checks
```

| Setting | Effect |
| --- | --- |
| `off` | The startup guide stands down for the repository and all its worktrees. A copy or move comes back on; submodules are configured separately. |
| `review` | `light` (default) runs repository checks, one independent whole-change review before the first push, and focused review of later repairs. `full` uses Thermos and Codex review and records formal evidence on every push. `checks` runs repository checks only where project policy allows. |

Set a personal review default with `git config --global railyard.review light`.
A repository's own value wins.

Railyard 0.15 retires the startup nudge (`railyard.ce`), shell merge guard
(`railyard.mergeGate`, `railyard.guardDefaultBranchPush`), and run log. Use
`railyard:config off` to opt a repository and its worktrees out of startup
guidance. Keep narrower publication or merge approval rules in the
repository's instructions.

Oracle and macOS Codex recovery moved to [Agent Utilities](https://github.com/novotnyllc/agent-utilities).
Use `agent-utilities:oracle` and `agent-utilities:cleanup-codex`.

Ponytail and Superpowers are not Railyard prerequisites. Native subagents are
the default for bounded parallel work; user-visible tasks are created only
when the user explicitly asks for them.

## The family

Machine and infrastructure administration lives in
[public fleet docs](https://novotnyllc.github.io/railyard/fleet/). The public product
story, scenarios, and guides live at
[novotnyllc.github.io/railyard](https://novotnyllc.github.io/railyard/). Charter and boundaries:
[AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).

The Thermos review skills adapt material from `cursor/plugins` (MIT).
Copyright notices are preserved in [LICENSE](LICENSE) and the incorporations are
itemized in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
