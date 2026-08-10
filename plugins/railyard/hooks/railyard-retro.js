#!/usr/bin/env node
// Stop (Claude Code) / SessionEnd (Codex): the auto-retrospective trigger.
// When a substantial run is ending without a recorded retrospective, remind
// the session to run the closing loop railyard:audit defines — recap →
// audit → retrospective → learnings/suggestions. The hook does NOT do that
// reasoning; it only surfaces the reminder. The session runs the loop.
//
// Always fail-open: it never blocks the stop (no decision:block, exit 0
// unconditionally), captures no prompt, diff, or secret, and reads only the
// run log's own mechanical counts and markers. An unreadable or absent log
// is silence, never an error.
//
// ponytail: counts today's file only and nudges once per session — a run
// that crosses midnight or wants richer heuristics can widen later; the
// backstop reminder does not need to be exact to be useful.
const fs = require("fs");

let logPath = null;
let record = () => {};
try {
  ({ logPath, record } = require("./run-log.js"));
} catch {}

// A run with at least this many dispatches is "substantial" enough to be
// worth a retrospective. Overridable for tests.
//
// Dispatches are not the only evidence of substance: a pure-ops run (fleet
// work, a release — multi-host/multi-repo/hours with zero subagents) records
// no dispatch at all. What it does record, per doctrine, is an `approach`
// decision line. Either signal makes the run substantial.
const MIN = Number(process.env.RAILYARD_RETRO_MIN || 2);

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  try {
    let payload = {};
    try {
      payload = JSON.parse(raw) || {};
    } catch {}
    const session = typeof payload.session_id === "string" ? payload.session_id : "";

    const file = logPath ? logPath() : null;
    if (!file || !fs.existsSync(file)) return; // no log: nothing to nudge about

    let dispatches = 0;
    let hasApproach = false;
    let hasRetro = false;
    let alreadyNudged = false;
    for (const ln of fs.readFileSync(file, "utf8").split("\n")) {
      if (!ln) continue;
      let e;
      try {
        e = JSON.parse(ln);
      } catch {
        continue; // tolerate a torn tail
      }
      // When we know our session, scope to it; otherwise fall back to the
      // whole day (coarse, but errs toward reminding).
      if (session && e.session_id && e.session_id !== session) continue;
      if (e.event === "dispatch") dispatches++;
      else if (e.event === "decision") hasApproach = true;
      else if (e.event === "retrospective" || e.event === "recap") hasRetro = true;
      else if (e.event === "retro_prompt") alreadyNudged = true;
    }

    if ((dispatches < MIN && !hasApproach) || hasRetro || alreadyNudged) return;

    // Mark that we nudged so repeated Stop events stay quiet (once per run).
    // Metadata only — a count and the session id, never content.
    record({ event: "retro_prompt", session_id: session || undefined, dispatches });

    const msg =
      "Railyard: this run " +
      (dispatches >= MIN
        ? "dispatched " + dispatches + " workers"
        : "opened an approach line") +
      " and is ending without a retrospective. Before you close it, run the" +
      " closing loop railyard:audit defines: the recap, then the retrospective —" +
      " generate pointed questions about THIS run, grade it against the kickoff" +
      " approach line (was the loop/isolation/evidence derived, did first" +
      " principles fire), and land any improvement in the two sinks" +
      " (ce-compound or ~/.config/railyard/learnings.md, and a" +
      " ~/.config/railyard/suggestions/ file). Non-blocking; skip only if the" +
      " run was genuinely trivial.";
    // systemMessage surfaces the reminder without blocking the stop.
    process.stdout.write(JSON.stringify({ systemMessage: msg }) + "\n");
  } catch {
    // fail open: a broken retrospective reminder never affects the session.
  }
  // No process.exit(): natural exit is 0, and on Windows exit() can truncate
  // a pipe-backed stdout write. Never set a non-zero code — this must not
  // block the stop.
});
