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
    "- Every subagent dispatch names an explicit model and effort — no",
    "  exceptions: omitting one silently inherits the session's premium tier.",
    "  Workers run the harness worker tier (Claude Code: Opus for",
    "  implementation/research/review, Sonnet/Haiku for mechanical); running",
    "  a child on the session's own tier is a named, justified escalation.",
    "  Cross-harness dispatch is explicit opt-in only — never a default.",
  ].join("\n") + "\n",
);
// No process.exit(): on Windows, pipe-backed stdout flushes asynchronously
// and exit() can truncate the write. Natural exit is code 0 anyway.
