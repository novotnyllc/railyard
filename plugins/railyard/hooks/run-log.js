#!/usr/bin/env node
// Append-only run log: the mechanical half of the how-it-ran audit. Hooks
// record what they can see (a dispatch happened, on which model, a session
// started, a worker finished); the orchestrating session records what only
// it knows (decisions, outcomes, deviations) through `note`.
//
// Metadata only — never prompts, handoff bodies, or provider output.
//
// Every write is best-effort and swallows all errors: this runs inside a
// PreToolUse gate and a SessionStart hook, and must never block, slow, or
// break either. One file per day; nothing rotates or prunes. railyard:audit
// reads at most the last few days, and doctor can flag an oversized
// directory later.
// ponytail: no rotation, no locking — O_APPEND small-line writes, a day
// file, and a reader that tolerates a torn tail. Add machinery only if the
// log ever gets big enough to matter.
const fs = require("fs");
const os = require("os");
const path = require("path");

function logDir() {
  if (process.env.RAILYARD_RUN_LOG_DIR) return process.env.RAILYARD_RUN_LOG_DIR;
  const home = os.homedir();
  // State, not config: machine-written, append-only, disposable. Mirrors
  // scripts/model-routing/paths.mjs, including the Windows location.
  return process.platform === "win32"
    ? path.join(process.env.LOCALAPPDATA || home, "railyard", "state", "run-log")
    : path.join(
        process.env.XDG_STATE_HOME || path.join(home, ".local", "state"),
        "railyard",
        "run-log",
      );
}

function logPath(now = new Date()) {
  return path.join(logDir(), now.toISOString().slice(0, 10) + ".jsonl");
}

// Which harness is running us. Both set CLAUDE_PLUGIN_ROOT and its cache
// path names the harness; callers that know better pass `harness` in the
// entry and override this. Unknown is a fine answer — the field is omitted.
function harness() {
  const root = process.env.CLAUDE_PLUGIN_ROOT || "";
  if (/[\\/]\.codex[\\/]/.test(root)) return "codex";
  if (/[\\/]\.claude[\\/]/.test(root)) return "claude-code";
  return "";
}

// Which session is running us, when the harness says so in the environment.
// Hook-written lines take the session id from their payload; a session-written
// `note` has no payload, so it reads the id the harness exports to the
// commands it spawns. The ACTIVE harness wins: a `codex exec` worker launched
// from Claude Code inherits the parent's CLAUDE_CODE_SESSION_ID alongside its
// own CODEX_THREAD_ID, and stamping the parent's id there would unbind the
// note from the run that wrote it. Unknown is a fine answer — the field is
// omitted, and readers that need the binding treat an unscoped line as not
// theirs.
function sessionId() {
  const claude = clip(process.env.CLAUDE_CODE_SESSION_ID);
  const codex = clip(process.env.CODEX_THREAD_ID);
  return harness() === "codex" ? codex || claude : claude || codex;
}

function clip(value, max = 120) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function record(entry) {
  try {
    const detected = harness();
    const line = {
      ts: new Date().toISOString(),
      ...(detected ? { harness: detected } : {}),
      ...entry,
    };
    const file = logPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(line) + "\n"); // O_APPEND
  } catch {
    // Never surface: an unwritable log is not a reason to fail a dispatch.
  }
}

module.exports = { record, clip, logPath, logDir };

if (require.main === module) {
  const [mode, arg] = process.argv.slice(2);
  if (mode === "path") {
    process.stdout.write(logPath() + "\n");
  } else if (mode === "note") {
    // Session-authored line: the doctrine grammar, passed as one JSON object.
    let entry = null;
    try {
      entry = JSON.parse(arg || "");
    } catch {}
    // Stamp the session so the line binds to the run that wrote it; an
    // explicit session_id in the entry still wins.
    if (entry && typeof entry === "object" && !Array.isArray(entry))
      record({ session_id: sessionId(), ...entry });
  } else if (mode === "hook") {
    // Hook-authored line: harness payload on stdin, event name in argv.
    let raw = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (raw += chunk));
    process.stdin.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(raw) || {};
      } catch {}
      record({ event: arg || "hook", session_id: clip(payload.session_id) });
    });
  }
}
