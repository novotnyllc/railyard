#!/usr/bin/env node
// SessionStart: inject the yardmaster routing charter as ambient context.
// Cross-platform, dependency-free, never blocks (always exit 0).
process.stdout.write(
  [
    "Yardmaster delivery routing: requests to implement, fix, ship, or 'go do'",
    "a software change route through yardmaster:deliver; requests to",
    "brainstorm, design, plan, spec, or debug software work also enter",
    "yardmaster:deliver and stop at the matching Compound Engineering",
    "artifact. Multi-task, fleet, or cross-machine objectives use",
    "yardmaster:orchestrate. Delivery turns begin with the read-only",
    "yardmaster:model-routing intake.",
  ].join("\n") + "\n",
);
process.exit(0);
