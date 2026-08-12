<img src="docs/assets/railyard.png" alt="Railyard" width="140" align="right"/>

# Railyard

**Say "go do X." Get back a merged, verified change — not a claim that it's
done.**

Railyard is a delivery system for AI agent work, for both Codex and Claude
Code. You talk in plain language; it picks the workflow, the model, the
budget, and the machine, then drives the change through implementation, deep
review, merge, and post-merge proof.

- 🚦 **One entry point.** "Implement…", "fix…", "ship…" — no skill names to
  remember, same behavior on either harness.
- 🧠 **One routing brain.** Every unit of work gets a recorded model, effort,
  and budget decision from a single router — no per-session improvisation.
- 🔍 **Quality by default.** Adversarial review gates, CI settlement, and
  post-merge verification are part of the route. "Green CI" isn't done —
  the merge commit reachable from main with a passing post-merge check is.
- 🖥️ **Fleet-scale.** Orchestrates across machines, and only dispatches to
  hosts its sibling [roundhouse](https://github.com/novotnyllc/roundhouse)
  has verified are ready.

```sh
claude plugin marketplace add novotnyllc/marketplace
claude plugin install railyard@novotnyllc
# then just say: "set up railyard"
```

(Codex: `codex plugin marketplace add novotnyllc/marketplace` and
`codex plugin add railyard --marketplace novotnyllc`.)

**Read the [public documentation](https://novotnyllc.github.io/)** — what it
can do, how it works, and what a delivery actually looks like.

## What's inside

Freight doesn't move itself — the yard receives it, sorts it, assembles the
train, clears the departure, and confirms arrival:

| Track | Skills |
| --- | --- |
| Setup & health | `setup` — onboarding, prerequisites on consent, host enrollment; `doctor` — diagnose and fix drift |
| Routing | `model-routing` — one model/effort/budget/transport decision per unit of work (`railyard/model-routing/v1`) |
| Delivery | `deliver` — one change through the right workflow to merge and post-merge proof |
| Orchestration & placement | `orchestrate` — objectives across tasks, projects, hosts; Codex saved-project and Claude SSH worker lanes |
| Quality gates | `thermos`, `thermo-nuclear-review`, `thermo-nuclear-code-quality-review`, `oracle` |
| Audit & retrospective | `audit` — how a run actually went: the decision chain, fan-out, deviations, and what to do better next time |
| Runtime hygiene | `cleanup-codex` |

## Built on Compound Engineering and ponytail

Installing railyard installs its required plugins automatically — Compound
Engineering and ponytail. They are documented, required dependencies, and the
railyard install is the consent for the whole group: one grouped install, no
separate approval step. (Privileged and signing steps — SSH enrollment, the
privilege broker — always keep their own explicit per-host consent; that is
never folded into this.)

Delivery routes through the external
[Compound Engineering](https://github.com/EveryInc/compound-engineering-plugin)
plugin (`lfg`, the `ce-*` skills, `ce-babysit-pr` 3.20.0+) as its workflow
engine, and [ponytail](https://github.com/DietrichGebert/ponytail) keeps the
work minimal — railyard carries the same efficiency discipline into its
process and verification loop. It never modifies either. `railyard:setup`
installs and updates them for you; by hand:

```sh
claude plugin marketplace add EveryInc/compound-engineering-plugin
claude plugin install compound-engineering@compound-engineering-plugin
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail
```

## The family

Machine and infrastructure administration lives in
[`roundhouse`](https://novotnyllc.github.io/roundhouse/). The public product
story, scenarios, and guides live at
[novotnyllc.github.io](https://novotnyllc.github.io/). Charter and boundaries:
[AGENTS.md](AGENTS.md).

## License

MIT — see [LICENSE](LICENSE).

Portions are adapted from `steipete/oracle` and `cursor/plugins` (both MIT),
with `steipete/agent-scripts` (MIT) reviewed alongside. Their copyright
notices are preserved in [LICENSE](LICENSE) and the incorporations are
itemized in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
