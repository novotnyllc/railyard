#!/usr/bin/env node
// SessionStart: print a small route guide immediately; read bounded hook metadata.

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
    "  follow authorized delivery through merge, required release or deployment,",
    "  and consumer verification. CE alone",
    "  owns review settlement and CI/PR monitoring; reuse its active watcher.",
    "  Before merging, use deliver's CE snapshot handoff for the merge guard.",
    "  A user-invoked Deliver change includes commit, PR, merge, required release",
    "  or deployment, and consumer verification unless explicitly narrowed.",
    "- Choose model AND reasoning effort for each agent assignment through",
    "  railyard:model-routing. Astra Max is the baseline candidate for substantive",
    "  Codex work. For Claude Code, consider Fable 5.1 with a deliberately chosen",
    "  effort. Use deterministic tools directly",
    "  for mechanical work. Deliberate inheritance is valid; omit model/effort",
    "  overrides on full-history native forks. Respect fixed-role tool controls.",
    "- Use native subagents for ordinary delegation. Create visible user-owned",
    "  tasks only on explicit user direction. Use railyard:orchestrate for",
    "  explicitly requested fleet/account allocation or delegated remote agents;",
    "  configured inventory alone does not activate it. Bounded one-host admin",
    "  uses the named native CLI or roundhouse:remote-mac over SSH directly.",
    "- Prefer child completion notifications; do independent work, then yield",
    "  only with a verified resume path or use a blocking event wait. Pass this",
    "  rule to children; avoid repeated status checks and duplicate work.",
    "- Verify the requested behavior and required repository checks. Contracts,",
    "  route receipts, retrospectives, and runtime cleanup are on-demand tools,",
    "  not prerequisites for ordinary work. Load only the references needed.",
  ].join("\n") + "\n",
);

// Presence enables advice, not an inference call or a credential disclosure.
if (process.env.TYPESAFE_API_KEY?.trim()) {
  process.stdout.write(
    "- Use railyard:jev by default for model and effort selection, workflow,\n"
    + "  evidence selection, work priority, and review triage throughout delivery.\n"
    + "  Honor explicit choices and offline/privacy restrictions;\n"
    + "  uncertain or unavailable advice falls back to normal Railyard reasoning.\n",
  );
}

// Native and Claude SessionStart JSON both carry session_id and cwd. The
// process environment may belong to an ancestor, so never substitute it for
// an absent payload identity. Missing/invalid input leaves an unidentified line.
const MAX_HOOK_INPUT_BYTES = 64 * 1024;
const INPUT_BUDGET_MS = 250;
let raw = "";
let finished = false;
const inputDeadline = setTimeout(() => finish(), INPUT_BUDGET_MS);

function metadata(value, max) {
  return typeof value === "string" && value.trim() && value.length <= max ? value : undefined;
}

function finish(payload) {
  if (finished) return;
  finished = true;
  clearTimeout(inputDeadline);
  process.stdin.pause();
  process.stdin.unref?.();
  const known = payload && typeof payload === "object" && !Array.isArray(payload)
    && payload.hook_event_name === "SessionStart";
  try {
    require("./run-log.js").record({
      event: "session",
      session_id: known ? metadata(payload.session_id, 120) : undefined,
      cwd: known ? metadata(payload.cwd, 4096) : undefined,
    });
  } catch {}
}

function parseInput(final = false) {
  if (finished) return;
  try { finish(JSON.parse(raw)); }
  catch { if (final) finish(); }
}

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  if (finished) return;
  if (Buffer.byteLength(raw) + Buffer.byteLength(chunk) > MAX_HOOK_INPUT_BYTES) {
    finish();
    return;
  }
  raw += chunk;
  parseInput();
});
process.stdin.on("end", () => parseInput(true));
process.stdin.on("error", () => finish());

// Natural exit lets pipe-backed stdout finish flushing on Windows.
