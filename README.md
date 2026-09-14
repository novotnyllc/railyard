<img src="docs/assets/railyard.png" alt="Railyard" width="140" align="right"/>

# Railyard

**Say what you want done. Get a verified result at the boundary you requested.**

Railyard helps Codex and Claude Code choose suitable models, reasoning effort,
and workflows without turning every edit into a delivery ceremony. Routine
work uses native tools and bounded subagents. A useful Compound Engineering
skill activates when the work calls for it; fleet and account orchestration
remain explicit choices.

- 🚦 **Plain-language work.** Native execution for routine changes, selected
  CE workflows for planning, debugging, review, and PR delivery when useful.
- 🧠 **Deliberate allocation.** Choose model and reasoning effort together.
  Astra Max is the baseline candidate for substantive engineering; suitable
  inheritance is an explicit choice, and unsupported selections are disclosed.
- 🔍 **One completion owner.** CE owns review settlement and CI watching for
  a selected PR workflow. Authorized shipping continues through merge and
  focused post-merge proof; narrower requests keep their stated endpoint.
- 🖥️ **Explicit fleet work.** Orchestrates across machines when requested,
  and only dispatches to
  hosts its sibling [roundhouse](https://github.com/novotnyllc/roundhouse)
  has verified are ready.

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

Freight doesn't move itself — the yard receives it, sorts it, assembles the
train, clears the departure, and confirms arrival:

| Track | Skills |
| --- | --- |
| Setup & health | `setup` — inspect and configure relevant prerequisites; `doctor` — diagnose and fix drift |
| Allocation | `model-routing` — model and effort decisions, with optional configured budgets and transport controls (`railyard/model-routing/v1`) |
| Delivery | `deliver` — select native execution or one useful CE workflow and complete the authorized scope |
| Orchestration & placement | `orchestrate` — explicit fleet/account work, cross-project coordination, and supported remote placement |
| Specialist review | `thermos`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`, `oracle` — when their perspective is useful |
| Optional audit | `audit` — explain a run's decisions, outcomes, and resource use when requested or useful |
| Runtime repair | `cleanup-codex` — inspect or repair a concrete process problem |

## Selected Compound Engineering workflows

Railyard uses the external
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
plugin for selected `ce-*` workflows. Use `ce-commit-push-pr` when creating a
PR or pushing user-requested commits to an existing PR. The selected CE
workflow owns review, feedback resolution, CI, and its watch loop; Railyard
does not add a second watcher or mandatory reviewer.

LFG remains available for an explicitly selected full workflow. Routine work
does not require it, a delivery contract, a retrospective, or process cleanup.
Startup performs no dependency bootstrap. Install CE through the plugin manager
when needed:

```sh
claude plugin marketplace add EveryInc/compound-engineering-plugin
claude plugin install compound-engineering@compound-engineering-plugin
```

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

Portions are adapted from `steipete/oracle` and `cursor/plugins` (both MIT),
with `steipete/agent-scripts` (MIT) reviewed alongside. Their copyright
notices are preserved in [LICENSE](LICENSE) and the incorporations are
itemized in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
