import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./routing-nudge.js", import.meta.url));
const fixtureConfig = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), "nudge-test-")),
  "config.json",
);
fs.writeFileSync(
  fixtureConfig,
  JSON.stringify({
    machines: {
      "silverstreak": { ssh_alias: "silverstreak", os: "mac" },
      "boxcar": { ssh_alias: "boxcar-ts", tailnet_name: "boxcar.tailnet.example", os: "linux" },
    },
  }),
);

function nudge(prompt, env = {}) {
  const run = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
    env: { ...process.env, ROUNDHOUSE_CONFIG: fixtureConfig, ...env },
  });
  assert.equal(run.status, 0);
  return run.stdout.trim();
}

test("delivery, orchestration, planning, and PR intents route", () => {
  assert.match(nudge("fix the login bug in the app"), /railyard:deliver\b/);
  assert.match(nudge("can you also run this on my other mac"), /orchestrate/);
  assert.match(
    nudge("1. add the endpoint 2. fix the tests 3. update the docs"),
    /orchestrate/,
  );
  assert.match(nudge("do these things in parallel please"), /orchestrate/);
  assert.match(nudge("update this across all my machines"), /orchestrate/);
  // Registered machine names from the fleet registry, not hardcoded types.
  assert.match(nudge("run the tests over on boxcar"), /orchestrate/);
  assert.match(nudge("deploy it to silverstreak tonight"), /orchestrate/);
  // Unregistered machine-ish words no longer match.
  assert.equal(nudge("put the file on the studio shelf list"), "");
  // Without a registry, generic phrasing still works and names do not.
  assert.match(
    nudge("run this on my other mac", { ROUNDHOUSE_CONFIG: "/nonexistent" }),
    /orchestrate/,
  );
  assert.equal(
    nudge("run the tests over on boxcar", { ROUNDHOUSE_CONFIG: "/nonexistent" }),
    "",
  );
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
  assert.match(nudge("update the plugins"), /Maintenance intent/);
  assert.match(nudge("can you sync my skills and packages"), /Maintenance intent/);
  assert.match(nudge("update the login page styling"), /Delivery intent/);
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
