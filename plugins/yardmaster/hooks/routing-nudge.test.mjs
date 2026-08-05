import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./routing-nudge.js", import.meta.url));

function nudge(prompt) {
  const run = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  return run.stdout.trim();
}

test("delivery, orchestration, planning, and PR intents route", () => {
  assert.match(nudge("fix the login bug in the app"), /yardmaster:deliver\b/);
  assert.match(nudge("can you also run this on my other mac"), /orchestrate/);
  assert.match(
    nudge("1. add the endpoint 2. fix the tests 3. update the docs"),
    /orchestrate/,
  );
  assert.match(nudge("do these things in parallel please"), /orchestrate/);
  assert.match(nudge("update this across all my machines"), /orchestrate/);
  assert.match(
    nudge("hey lets update the plan for the sync thing"),
    /Planning\/brainstorming/,
  );
  assert.match(
    nudge("whats the best way to structure the api here"),
    /Planning\/brainstorming/,
  );
  assert.match(
    nudge("babysit that PR until the feedback is resolved"),
    /PR routes/,
  );
});

test("ordinary conversation stays silent", () => {
  for (const p of [
    "fix this sentence it reads awkwardly",
    "1. milk 2. eggs 3. bread 4. coffee",
    "thanks that looks great",
    "what did we decide about lunch",
    "update my calendar for tomorrow",
    "ok",
    "/model claude-fable-5",
  ]) {
    assert.equal(nudge(p), "", `expected silence for: ${p}`);
  }
});

test("malformed input is silently tolerated", () => {
  const run = spawnSync(process.execPath, [script], {
    input: "not json at all",
    encoding: "utf8",
  });
  assert.equal(run.status, 0);
  assert.equal(run.stdout.trim(), "");
});
