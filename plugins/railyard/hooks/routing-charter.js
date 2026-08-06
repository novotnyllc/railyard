#!/usr/bin/env node
// SessionStart: inject the railyard routing charter as ambient context.
// Once per session, ~7 lines. Cross-platform, dependency-free, never blocks.
process.stdout.write(
  [
    "Railyard routing:",
    "- Software change requests (implement/fix/ship/'go do it') route through",
    "  railyard:deliver, starting with its read-only model-routing intake.",
    "  Done means authorized merge plus post-merge proof — not green CI.",
    "- Brainstorming, planning, spec, or debugging of software work — even",
    "  arising mid-conversation — routes through railyard:deliver to the",
    "  matching CE stage and stops at that artifact.",
    "- Several independent pieces of work, work meant for another machine, or",
    "  fleet-wide operations route through railyard:orchestrate (readiness",
    "  via roundhouse; never raw SSH pretending to be an agent).",
    "- Existing-PR watching/fixing/driving uses deliver's PR routes; a deep",
    "  pre-commit review is railyard:thermos.",
    "- Plugin/skill/package/fleet maintenance is roundhouse's mechanical-tier",
    "  work: a premium-model session delegates it to a cheap-model child",
    "  (skills cannot switch the session model) rather than running inline.",
    "- Every subagent/thread dispatch names an explicit model and effort —",
    "  enforced by a PreToolUse gate; worker tier by default (Opus impl/",
    "  research/review, Sonnet/Haiku mechanical), session tier only as a",
    "  named escalation. Cross-harness dispatch is explicit opt-in only.",
    "  Exact per-harness parameters: railyard:model-routing.",
    "- Plan end-to-end for minimum wall time and token spend: long pole",
    "  first (background when nothing collides); batch fixes into one",
    "  commit/CI/deploy cycle — never spend a cycle on a partial batch or",
    "  re-run an unchanged check.",
  ].join("\n") + "\n",
);
// No process.exit(): on Windows, pipe-backed stdout flushes asynchronously
// and exit() can truncate the write. Natural exit is code 0 anyway.
