import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "railyard-retro.js");

// Seed a hermetic run-log dir with the given JSONL lines (today's file).
function seedLog(lines) {
  const dir = mkdtempSync(path.join(tmpdir(), "retro-log-"));
  const file = path.join(dir, new Date().toISOString().slice(0, 10) + ".jsonl");
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return dir;
}

function run(sessionId, logDir, min) {
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ session_id: sessionId }),
    encoding: "utf8",
    env: {
      ...process.env,
      RAILYARD_RUN_LOG_DIR: logDir ?? mkdtempSync(path.join(tmpdir(), "retro-empty-")),
      ...(min != null ? { RAILYARD_RETRO_MIN: String(min) } : {}),
    },
  });
  let out = {};
  try {
    out = r.stdout.trim() ? JSON.parse(r.stdout.trim()) : {};
  } catch {}
  return { code: r.status, out, stdout: r.stdout };
}

function readLog(dir) {
  return readdirSync(dir)
    .flatMap((f) => readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean))
    .map((l) => JSON.parse(l));
}

const dispatch = (session) => ({ event: "dispatch", session_id: session, model: "opus" });

test("substantial run without a retrospective is nudged", () => {
  const dir = seedLog([dispatch("s1"), dispatch("s1")]);
  const r = run("s1", dir);
  assert.equal(r.code, 0); // never blocks
  assert.match(r.out.systemMessage, /retrospective/i);
  assert.match(r.out.systemMessage, /railyard:audit/);
  rmSync(dir, { recursive: true, force: true });
});

test("the nudge never blocks the stop (no decision:block, no non-zero exit)", () => {
  const dir = seedLog([dispatch("s1"), dispatch("s1")]);
  const r = run("s1", dir);
  assert.equal(r.code, 0);
  assert.equal(r.out.decision, undefined);
  assert.notEqual(r.out.continue, false);
  rmSync(dir, { recursive: true, force: true });
});

test("a trivial run (below threshold) is not nudged", () => {
  const dir = seedLog([dispatch("s1")]);
  const r = run("s1", dir);
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "");
  rmSync(dir, { recursive: true, force: true });
});

test("a run that already recorded a retrospective is not nudged", () => {
  const dir = seedLog([dispatch("s1"), dispatch("s1"), { event: "retrospective", session_id: "s1" }]);
  const r = run("s1", dir);
  assert.equal(r.stdout.trim(), "");
  rmSync(dir, { recursive: true, force: true });
});

test("dispatches from other sessions do not count", () => {
  const dir = seedLog([dispatch("other"), dispatch("other"), dispatch("s1")]);
  const r = run("s1", dir);
  assert.equal(r.stdout.trim(), ""); // only one dispatch is ours
  rmSync(dir, { recursive: true, force: true });
});

test("the nudge fires once: a recorded retro_prompt suppresses repeats", () => {
  const dir = seedLog([dispatch("s1"), dispatch("s1")]);
  const first = run("s1", dir);
  assert.match(first.out.systemMessage, /retrospective/i);
  // The hook recorded its own retro_prompt marker.
  assert.ok(readLog(dir).some((e) => e.event === "retro_prompt" && e.session_id === "s1"));
  const second = run("s1", dir);
  assert.equal(second.stdout.trim(), "");
  rmSync(dir, { recursive: true, force: true });
});

test("the marker is metadata only: no prompt/secret capture", () => {
  const dir = seedLog([dispatch("s1"), dispatch("s1")]);
  run("s1", dir);
  const marker = readLog(dir).find((e) => e.event === "retro_prompt");
  assert.deepEqual(Object.keys(marker).sort(), ["dispatches", "event", "session_id", "ts"]);
  assert.equal(marker.dispatches, 2);
  rmSync(dir, { recursive: true, force: true });
});

test("an absent run log is silent, never an error", () => {
  const r = run("s1"); // fresh empty dir, no file
  assert.equal(r.code, 0);
  assert.equal(r.stdout.trim(), "");
});

test("garbage stdin fails open", () => {
  const r = spawnSync(process.execPath, [script], {
    input: "not json",
    encoding: "utf8",
    env: { ...process.env, RAILYARD_RUN_LOG_DIR: mkdtempSync(path.join(tmpdir(), "retro-empty-")) },
  });
  assert.equal(r.status, 0);
});

test("threshold is overridable", () => {
  const dir = seedLog([dispatch("s1")]);
  const r = run("s1", dir, 1); // MIN=1 makes a single dispatch substantial
  assert.match(r.out.systemMessage, /retrospective/i);
  rmSync(dir, { recursive: true, force: true });
});
