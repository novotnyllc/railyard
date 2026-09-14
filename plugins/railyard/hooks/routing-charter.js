#!/usr/bin/env node
// SessionStart: a small route guide, with no dependency bootstrap or blocking I/O.

process.stdout.write(
  [
    "Railyard routing:",
    "- Use native tools for ordinary local work. Automatically select the CE",
    "  skill that helps: ce-debug for difficult diagnosis, ce-plan for substantial",
    "  planning, ce-code-review for useful review, or lfg for a coordinated full",
    "  workflow. Routine fixes can stay direct; railyard:deliver coordinates",
    "  stages when needed. Use compound-engineering:ce-commit-push-pr when",
    "  creating a PR or pushing user-requested commits to an existing PR.",
    "- Complete the user's requested scope: preserve plan/local-only stops and",
    "  follow authorized delivery through merge and post-merge proof. CE alone",
    "  owns review settlement and CI/PR monitoring; reuse its active watcher.",
    "- Choose model AND reasoning effort for each agent assignment through",
    "  railyard:model-routing. Astra Max is the baseline candidate for substantive",
    "  engineering, not a universal cost claim. Use deterministic tools directly",
    "  for mechanical work. Deliberate inheritance is valid; omit model/effort",
    "  overrides on full-history native forks. Respect fixed-role tool controls.",
    "- Use native subagents for ordinary delegation. Create visible user-owned",
    "  tasks only on explicit user direction. Use railyard:orchestrate for",
    "  explicitly requested fleet/account allocation or delegated remote agents;",
    "  configured inventory alone does not activate it. Bounded one-host admin",
    "  uses the named native CLI or roundhouse:remote-mac over SSH directly.",
    "- Verify the requested behavior and required repository checks. Contracts,",
    "  route receipts, retrospectives, and runtime cleanup are on-demand tools,",
    "  not prerequisites for ordinary work. Load only the references needed.",
  ].join("\n") + "\n",
);

// Preserve the best-effort metadata anchor without making logging a prerequisite.
try {
  require("./run-log.js").record({ event: "session", cwd: process.cwd() });
} catch {}

// Natural exit lets pipe-backed stdout finish flushing on Windows.
