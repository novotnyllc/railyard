import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, truncateSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), "merge-settlement-gate.js");
const SKIP_WIN = process.platform === "win32" ? "gh shim uses POSIX sh" : false;
const gated = (name, fn) => test(name, { skip: SKIP_WIN }, fn);
const HEAD = "a36a1cf89334911b243c7e9e3d368ce21598394a";
const BASE = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";
const URL = "https://github.com/novotnyllc/railyard/pull/7";
const PIN = `--match-head-commit ${HEAD}`;
const bash = (command) => ({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command } });
const fullMerge = `gh pr merge ${URL} --squash ${PIN}`;

// CE 3.25 snapshot stdout and its sibling persisted state have different
// schemas. Only stdout carries computed readiness flags. No invented receipt.
function evidence(url = URL) {
  const target = new globalThis.URL(url);
  const [, owner, repo, , number] = target.pathname.split("/");
  const now = Date.now() - 100;
  const startedAt = new Date(now - 20_000).toISOString();
  const base = { host: target.host, repository: `${owner}/${repo}`, ref: "main", oid: BASE, identity: "current" };
  const snapshot = {
    url, head_sha: HEAD, invocation_id: "ce-fixture-invocation", tick: 3,
    invocation_started_at: startedAt, invocation_wall_elapsed_seconds: 20,
    base: { ...base }, pr_state: "OPEN", pr_is_draft: false,
    mergeability_certain: true, mergeable: "MERGEABLE", merge_state_status: "CLEAN",
    checks_terminal: true, has_failing_checks: false, checks_present: true,
    all_checks_ok: true, checks_awaiting_approval: 0, blocked_external: false,
    base_ref_blocker: null, stack_blocker: null, branch_currency_blocker: null,
    unrequested_base_merge: null, unrequested_base_merge_pending: false,
    open_needs_human: 0, needs_human_residuals: [], needs_human_ids: [],
    counts: { ci: 0, threads: 0, comments: 0, needs_human: 0 },
    actionable: { ci: [], threads: [], comments: [] },
    // The consumer never implements CE's quiet-window or review judgment.
    quiet_seconds: 0,
  };
  const state = {
    pr: { owner, repo, number: Number(number), url },
    head_sha: HEAD, invocation_id: snapshot.invocation_id, tick: snapshot.tick,
    started_at: startedAt, last_activity_at: new Date(now).toISOString(),
    base: { ...base }, mergeable: "MERGEABLE", merge_state_status: "CLEAN",
    awaiting_approval: 0, stop_reason: null,
  };
  const live = {
    url, state: "OPEN", isDraft: false, headRefOid: HEAD,
    baseRefName: "main", baseRef: { target: { oid: BASE } },
    mergeable: "MERGEABLE", mergeStateStatus: "CLEAN",
    isMergeQueueEnabled: false,
    reviewThreads: { nodes: [{ isResolved: true }], pageInfo: { hasNextPage: false, endCursor: "cursor-1" } },
  };
  return { snapshot, state, live, number: Number(number) };
}

const SHIM = `#!/bin/sh
printf '%s\\n' "$1 $2" >> "$GH_CALL_LOG"
printf '%s\\n' "$GH_HOST" >> "$GH_HOST_LOG"
printf '%s\\n' "$GH_TOKEN" >> "$GH_TOKEN_LOG"
printf '%s\\n' "$XDG_CONFIG_HOME" >> "$GH_XDG_LOG"
printf '%s\\n' "$@" >> "$GH_ARG_LOG"
pwd >> "$GH_CWD_LOG"
if [ -n "$GH_FIXTURE_SLEEP" ]; then sleep "$GH_FIXTURE_SLEEP"; fi
if [ -n "$GH_FIXTURE_FAIL" ]; then echo "fixture authentication failed" >&2; exit 1; fi
case "$1 $2" in
  "pr view") printf '%s' "$GH_FIXTURE_VIEW" ;;
  "api graphql") case "$*" in
    *after=*) printf '%s' "$GH_FIXTURE_GRAPHQL_NEXT" ;;
    *) printf '%s' "$GH_FIXTURE_GRAPHQL" ;;
  esac ;;
  *) echo "unexpected gh invocation" >&2; exit 3 ;;
esac
`;

function prepare(fixtures = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "ce-merge-gate-"));
  const shim = path.join(dir, "gh");
  writeFileSync(shim, SHIM);
  chmodSync(shim, 0o755);
  const logs = Object.fromEntries(["calls", "hosts", "tokens", "xdg", "cwds", "args"].map((name) => [name, path.join(dir, `${name}.log`)]));
  for (const filename of Object.values(logs)) writeFileSync(filename, "");
  const data = evidence(fixtures.url);
  fixtures.mutate?.(data);
  const snapshotPath = path.join(dir, "snapshot.json");
  if (!fixtures.noSnapshot) writeFileSync(snapshotPath, fixtures.snapshotText ?? JSON.stringify(data.snapshot));
  if (!fixtures.noState) writeFileSync(path.join(dir, "state.json"), fixtures.stateText ?? JSON.stringify(data.state));
  fixtures.prepareFiles?.({ snapshotPath, statePath: path.join(dir, "state.json") });
  const env = {
    ...process.env,
    PATH: `${dir}${path.delimiter}${process.env.PATH}`,
    RAILYARD_CE_SNAPSHOT: fixtures.noPath ? "" : snapshotPath,
    RAILYARD_CE_MODE: fixtures.mode ?? "",
    GH_CALL_LOG: logs.calls, GH_HOST_LOG: logs.hosts, GH_TOKEN_LOG: logs.tokens,
    GH_XDG_LOG: logs.xdg, GH_CWD_LOG: logs.cwds, GH_ARG_LOG: logs.args,
    GH_HOST: fixtures.ambientHost ?? "", GH_REPO: "", GH_TOKEN: "", XDG_CONFIG_HOME: "",
    GH_FIXTURE_VIEW: fixtures.view ?? JSON.stringify({ number: data.number, url: data.snapshot.url }),
    GH_FIXTURE_GRAPHQL: fixtures.graphql ?? JSON.stringify({ data: { repository: { pullRequest: data.live } } }),
    GH_FIXTURE_GRAPHQL_NEXT: fixtures.graphqlNext ?? "",
    GH_FIXTURE_FAIL: fixtures.fail ? "1" : "", GH_FIXTURE_SLEEP: fixtures.sleep ?? "",
    // Override records land here, never in the developer's own state dir.
    RAILYARD_RUN_LOG_DIR: fixtures.runLogDir ?? path.join(dir, "run-log"),
    // gh aliases come from this directory, never the developer's own config.
    GH_CONFIG_DIR: path.join(dir, "gh-config"),
    RAILYARD_GUARD_DEFAULT_BRANCH_PUSH: "",
    // The push guard reads git config; the developer's own must not leak in.
    GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1",
  };
  const finish = (result) => {
    const calls = readFileSync(logs.calls, "utf8").trim().split("\n").filter(Boolean);
    const lines = (name) => readFileSync(logs[name], "utf8").split("\n").slice(0, calls.length);
    const output = { code: result.status, err: result.stderr, calls,
      hosts: lines("hosts"), tokens: lines("tokens"), xdg: lines("xdg"), cwds: lines("cwds"),
      args: readFileSync(logs.args, "utf8"), records: runLogRecords(env.RAILYARD_RUN_LOG_DIR) };
    rmSync(dir, { recursive: true, force: true });
    return output;
  };
  return { env, snapshotPath, finish };
}

function runLogRecords(dir) {
  try {
    return readdirSync(dir).flatMap((name) => readFileSync(path.join(dir, name), "utf8")
      .trim().split("\n").filter(Boolean).map((line) => JSON.parse(line)));
  } catch { return []; }
}

function run(input, fixtures = {}) {
  const setup = prepare(fixtures);
  const payload = typeof input === "function" ? input(setup.snapshotPath) : input;
  const result = spawnSync(process.execPath, [script], {
    input: typeof payload === "string" ? payload : JSON.stringify(payload),
    encoding: "utf8", env: setup.env, timeout: 6000,
  });
  return setup.finish(result);
}

function refused(result, reason) {
  assert.equal(result.code, 2, result.err);
  assert.match(result.err, /Merge refused/);
  if (reason) assert.match(result.err, reason);
  assert.match(result.err, /ce-babysit-pr/);
  assert.doesNotMatch(result.err, /allowing the merge|waiting is always sufficient|hard cap/i);
}

// No snapshot: the live check decides. A BLOCKED live PR shows that a merge
// reached that check and was refused there.
const BLOCKED = { noPath: true, mutate: ({ live }) => { live.mergeStateStatus = "BLOCKED"; } };
// Any refusal on the no-snapshot path, including a merge that is not one
// literal command; parser refusals (a merge it cannot attribute) lack it.
const LIVE_GATED = /without a CE snapshot/;

function allowed(result, calls = ["api graphql"]) {
  assert.equal(result.code, 0, result.err);
  assert.equal(result.err, "");
  assert.deepEqual(result.calls, calls);
}

// A real, settled CE 3.28.0 snapshot/state pair (captured from a merged PR,
// watcher details neutralized). Identity and timing fields are re-bound to
// the fixture PR; every other field keeps 3.28.0's actual shape.
gated("CE 3.28.0 settled snapshot and state are accepted", () => {
  const captured = JSON.parse(readFileSync(path.join(path.dirname(script), "fixtures", "ce-3.28.0-settled.json"), "utf8"));
  const result = run(bash(fullMerge), {
    mode: "interactive",
    mutate(data) {
      const bind = ["url", "head_sha", "invocation_id", "tick", "invocation_started_at", "invocation_wall_elapsed_seconds", "base"];
      data.snapshot = { ...captured.snapshot, ...Object.fromEntries(bind.map((key) => [key, data.snapshot[key]])) };
      const bindState = ["pr", "head_sha", "invocation_id", "tick", "started_at", "last_activity_at", "base"];
      data.state = { ...captured.state, ...Object.fromEntries(bindState.map((key) => [key, data.state[key]])) };
    },
  });
  allowed(result);
});

gated("CE pipeline result allows a pinned current PR without any reviewer or timing query", () => {
  const result = run(bash(fullMerge));
  allowed(result);
  assert.match(result.args, /baseRef\{target\{oid\}\}/);
  assert.doesNotMatch(result.args, /reviews|reviewThreads|reactions|committedDate/);
});

gated("interactive CE settlement accepts no configured checks; pipeline does not", () => {
  const noChecks = ({ snapshot }) => { snapshot.checks_present = false; snapshot.all_checks_ok = false; };
  allowed(run(bash(fullMerge), { mode: "interactive", mutate: noChecks }));
  refused(run(bash(fullMerge), { mutate: noChecks }), /pipeline check conditions/);
});

gated("inline snapshot selection is honored", () => {
  allowed(run((filename) => bash(`RAILYARD_CE_SNAPSHOT='${filename}' RAILYARD_CE_MODE=pipeline ${fullMerge}`), { noPath: true }));
});

gated("a supplied snapshot path must still be absolute; it never falls back to the live check", () => {
  const result = run(bash(`RAILYARD_CE_SNAPSHOT=relative/snapshot.json ${fullMerge}`), { noPath: true });
  refused(result, /absolute path/);
  assert.deepEqual(result.calls, []);
});

// Without RAILYARD_CE_SNAPSHOT, GitHub's live view decides.
const thread = (isResolved) => ({ isResolved });
const threadPage = (nodes, hasNextPage = false, endCursor = hasNextPage ? "cursor-1" : null) => ({ nodes, pageInfo: { hasNextPage, endCursor } });
const livePage = (reviewThreads) => JSON.stringify({ data: { repository: { pullRequest: { ...evidence().live, reviewThreads } } } });

gated("without a snapshot, a clean PR with no unresolved threads merges with a plain gh pr merge", () => {
  const bare = run(bash("gh pr merge 7 --squash"), { noPath: true });
  allowed(bare, ["pr view", "api graphql"]);
  assert.match(bare.args, /reviewThreads\(first:100,after:\$after\)\{nodes\{isResolved\}/);
  assert.match(bare.args, /number=7/);
  allowed(run(bash(`gh pr merge ${URL} --merge --delete-branch`), { noPath: true }));
  allowed(run(bash("gh api -X PUT repos/novotnyllc/railyard/pulls/7/merge -f merge_method=squash"), { noPath: true }));
  allowed(run(bash(`gh pr merge ${URL} --squash`), { noPath: true, mutate: ({ live }) => { live.reviewThreads = threadPage([]); } }));
});

for (const [name, change, reason] of [
  ["merged", (live) => { live.state = "MERGED"; }, /the PR is MERGED/],
  ["closed", (live) => { live.state = "CLOSED"; }, /the PR is CLOSED/],
  ["draft", (live) => { live.isDraft = true; }, /: draft\./],
  ["blocked", (live) => { live.mergeStateStatus = "BLOCKED"; }, /mergeStateStatus BLOCKED/],
  ["behind", (live) => { live.mergeStateStatus = "BEHIND"; }, /mergeStateStatus BEHIND/],
  ["unstable checks", (live) => { live.mergeStateStatus = "UNSTABLE"; }, /mergeStateStatus UNSTABLE/],
  ["not yet computed", (live) => { live.mergeStateStatus = "UNKNOWN"; }, /mergeStateStatus UNKNOWN/],
  ["one unresolved thread", (live) => { live.reviewThreads = threadPage([thread(true), thread(false)]); }, /: 1 unresolved review thread\./],
  ["two unresolved threads", (live) => { live.reviewThreads = threadPage([thread(false), thread(true), thread(false)]); }, /: 2 unresolved review threads\./],
  ["several reasons", (live) => { live.isDraft = true; live.mergeStateStatus = "DRAFT"; live.reviewThreads = threadPage([thread(false)]); },
    /: draft, mergeStateStatus DRAFT, 1 unresolved review thread\./],
]) gated(`without a snapshot, a live ${name} PR refuses with its reason`, () => {
  const result = run(bash(`gh pr merge ${URL} --squash`), { noPath: true, mutate: ({ live }) => change(live) });
  refused(result, reason);
  assert.deepEqual(result.calls, ["api graphql"]);
});

// gh pr merge only enqueues there; the queue merges after this check (Codex review).
gated("without a snapshot, a merge-queue base refuses with queue advice, not a PR fix", () => {
  const queued = run(bash(`gh pr merge ${URL} --squash --admin`), { noPath: true, mutate: ({ live }) => { live.isMergeQueueEnabled = true; } });
  refused(queued, /: the base branch uses a merge queue\. The queue merges after any point-in-time check/);
  assert.doesNotMatch(queued.err, /fix that and retry/);
  assert.deepEqual(queued.calls, ["api graphql"]);
  const unknown = run(bash(`gh pr merge ${URL} --squash`), { noPath: true, mutate: ({ live }) => { delete live.isMergeQueueEnabled; } });
  refused(unknown, /: merge queue status unknown\. A merge without a CE snapshot needs a certain live read/);
});

gated("without a snapshot, review threads are read across pages", () => {
  const firstPage = (live) => { live.reviewThreads = threadPage([thread(true)], true); };
  const resolved = run(bash(`gh pr merge ${URL} --squash`), {
    noPath: true, mutate: ({ live }) => firstPage(live), graphqlNext: livePage(threadPage([thread(true)])),
  });
  allowed(resolved, ["api graphql", "api graphql"]);
  assert.match(resolved.args, /after=cursor-1/);
  const later = run(bash(`gh pr merge ${URL} --squash`), {
    noPath: true, mutate: ({ live }) => firstPage(live), graphqlNext: livePage(threadPage([thread(true), thread(false)])),
  });
  refused(later, /: 1 unresolved review thread\./);
  // Each page's PR state is checked again: a later page that reports a block refuses.
  const blockedLater = run(bash(`gh pr merge ${URL} --squash --admin`), {
    noPath: true, mutate: ({ live }) => firstPage(live),
    graphqlNext: JSON.stringify({ data: { repository: { pullRequest: { ...evidence().live, mergeStateStatus: "BLOCKED", reviewThreads: threadPage([thread(true)]) } } } }),
  });
  refused(blockedLater, /: mergeStateStatus BLOCKED\./);
  assert.deepEqual(blockedLater.calls, ["api graphql", "api graphql"]);
  // A page that claims more but repeats its cursor refuses instead of looping (CodeRabbit).
  const stuck = run(bash(`gh pr merge ${URL} --squash`), {
    noPath: true, mutate: ({ live }) => firstPage(live), graphqlNext: livePage(threadPage([thread(true)], true)),
  });
  refused(stuck, /does not advance/);
  assert.match(stuck.err, /certain live read/);
  assert.deepEqual(stuck.calls, ["api graphql", "api graphql"]);
  // Once a page already refuses, the remaining pages are not read.
  const early = run(bash(`gh pr merge ${URL} --squash`), {
    noPath: true, mutate: ({ live }) => { live.reviewThreads = threadPage([thread(false), thread(false)], true); },
  });
  refused(early, /at least 2 unresolved review threads/);
  assert.deepEqual(early.calls, ["api graphql"]);
});

gated("without a snapshot, an unreadable or uncertain GitHub answer fails closed", () => {
  for (const fixtures of [
    { fail: true },
    { graphql: "not JSON" },
    { graphql: JSON.stringify({ errors: [{ message: "unavailable" }], data: null }) },
    { mutate: ({ live }) => { delete live.reviewThreads; } },
    { mutate: ({ live }) => { live.reviewThreads = { nodes: [] }; } },
    { mutate: ({ live }) => { live.reviewThreads = threadPage([thread(true)], true, null); } },
    { mutate: ({ live }) => { live.reviewThreads = threadPage([thread(true)], true); }, graphqlNext: "not JSON" },
    { mutate: ({ live }) => { live.url = live.url.replace("/7", "/8"); } },
  ]) {
    const result = run(bash(`gh pr merge ${URL} --squash`), { noPath: true, ...fixtures });
    refused(result);
    // An uncertain read asks for a retry, not a fix to the PR.
    assert.doesNotMatch(result.err, /fix that and retry/);
  }
  // An unknown field reads as not ready, never as ready.
  for (const [change, reason] of [
    [(live) => { live.reviewThreads = threadPage([thread(null)]); }, /: 1 unresolved review thread\./],
    [(live) => { delete live.isDraft; }, /: draft status unknown\./],
    [(live) => { delete live.mergeStateStatus; }, /: mergeStateStatus unknown\./],
  ]) refused(run(bash(`gh pr merge ${URL} --squash`), { noPath: true, mutate: ({ live }) => change(live) }), reason);
  const started = Date.now();
  refused(run(bash("gh pr merge 7 --squash"), { noPath: true, sleep: "4" }));
  assert.ok(Date.now() - started < 5000);
});

// Nothing pins the head on the no-snapshot path, so the merge the gate checks
// must be the merge the shell runs (Thermos and Codex review P1).
gated("without a snapshot, only one literal merge command reaches the live check", () => {
  for (const command of [
    "git switch other && gh pr merge --squash --admin",
    "gh pr checkout 8 && gh pr merge --squash",
    'gh pr merge 7 --squash --repo "$REPO"',
    "gh pr merge 7 --squash -R ${OWNER}/railyard",
    "R=--repo=o/other; gh pr merge 7 --squash $R",
    "sleep 3600; gh pr merge 7 --squash",
    "until gh pr merge 7 --squash; do sleep 60; done",
    "echo ready\ngh pr merge 7 --squash",
    "timeout 60 gh pr merge 7 --squash",
    "GH_REPO=novotnyllc/railyard gh pr merge 7 --squash",
    `eval "$(cat <<'EOF'\ngh pr merge 7 --admin\nEOF\n)"`,
  ]) {
    const result = run(bash(command), { noPath: true });
    refused(result, LIVE_GATED);
    assert.deepEqual(result.calls, [], command);
  }
  // A literal cd, a cleared snapshot and a branch target stay plain merges.
  const target = mkdtempSync(path.join(tmpdir(), "ce-merge-plain-"));
  try {
    const moved = run(bash(`cd ${target} && gh pr merge 7 --squash`), { noPath: true });
    allowed(moved, ["pr view", "api graphql"]);
    assert.ok(moved.cwds.every((cwd) => cwd.endsWith(path.basename(target))));
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
  allowed(run(bash("RAILYARD_CE_SNAPSHOT= gh pr merge 7 --squash"), { noPath: true }), ["pr view", "api graphql"]);
  const branch = run(bash("gh pr merge feature/x --repo novotnyllc/railyard --squash"), { noPath: true });
  allowed(branch, ["pr view", "api graphql"]);
  assert.match(branch.args, /^pr\nview\nfeature\/x\n--repo\nnovotnyllc\/railyard\n/);
  allowed(run(bash(`gh pr merge 7 --squash --match-head-commit ${HEAD}`), { noPath: true }), ["pr view", "api graphql"]);
});

gated("a live shape refusal says how to write the merge, not what to fix on the PR", () => {
  for (const command of ["gh pr merge 7 --squash 2>&1", "gh pr merge 7 --squash | tail -5", "gh pr merge 7 --squash;"]) {
    const result = run(bash(command), { noPath: true });
    refused(result, /Run the merge alone as one literal gh pr merge/);
    assert.doesNotMatch(result.err, /fix that and retry/, command);
  }
});

gated("the gate's parser and the literal allow-list must agree on the merge", () => {
  const { plainMergeShape, sameMerge } = createRequire(import.meta.url)("./merge-override.js");
  const { shape } = plainMergeShape("gh pr merge 7 --repo novotnyllc/railyard --squash");
  const parsed = (ref, repo) => [{ kind: "pr", ref, flags: new Map(repo ? [["--repo", repo]] : []) }];
  assert.ok(sameMerge(shape, parsed("7", "novotnyllc/railyard")));
  assert.ok(!sameMerge(shape, parsed("8", "novotnyllc/railyard")));
  assert.ok(!sameMerge(shape, parsed("7", "other/repo")));
  assert.ok(!sameMerge(shape, [...parsed("7", "novotnyllc/railyard"), ...parsed("7", "novotnyllc/railyard")]));
  assert.ok(!sameMerge(shape, [{ kind: "api", endpoint: ["repos/novotnyllc/railyard/pulls/7/merge"] }]));
});

gated("a refused snapshot keeps the CE recovery and never suggests dropping it", () => {
  const result = run(bash(fullMerge), { mutate: ({ snapshot }) => { snapshot.counts.comments = 1; } });
  refused(result, /unresolved work/);
  assert.doesNotMatch(result.err, LIVE_GATED);
  assert.match(result.err, /save its final snapshot stdout beside state.json/);
});

gated("without a snapshot, the parser and --auto guards still apply first", () => {
  refused(run(bash("gh pr merge 7 --squash --auto"), { noPath: true }), /--auto can queue/);
  refused(run(bash("cd ~/elsewhere && gh pr merge 7 --squash"), { noPath: true }), /unresolved or conditional `cd`/);
  const many = run(bash("gh pr merge 7 --squash && gh pr merge 8 --squash"), { noPath: true });
  refused(many, /one PR per command/);
  assert.deepEqual(many.calls, []);
});

for (const [name, fixtures, reason] of [
  ["missing snapshot file", { noSnapshot: true }, /CE snapshot is missing/],
  ["malformed snapshot", { snapshotText: "not JSON" }, /invalid JSON/],
  ["snapshot array", { snapshotText: "[]" }, /JSON object/],
  ["raw state instead of snapshot stdout", { snapshotText: JSON.stringify(evidence().state) }, /same PR/],
  ["missing sibling state", { noState: true }, /state.json is missing/],
  ["malformed sibling state", { stateText: "{" }, /invalid JSON/],
  ["unknown mode", { mode: "automatic" }, /pipeline or interactive/],
]) gated(`${name} refuses before any network read`, () => {
  const result = run(bash(fullMerge), fixtures);
  refused(result, reason);
  assert.deepEqual(result.calls, []);
});

for (const [name, change, reason] of [
  ["PR identity", ({ state }) => { state.pr.number = 8; }, /same PR/],
  ["host identity", ({ state }) => { state.pr.url = state.pr.url.replace("github.com", "example.com"); }, /same PR/],
  ["invocation", ({ state }) => { state.invocation_id = "new-invocation"; }, /latest invocation/],
  ["tick", ({ state }) => { state.tick++; }, /latest invocation/],
  ["head", ({ state }) => { state.head_sha = OTHER; }, /latest invocation/],
  ["base", ({ state }) => { state.base.oid = OTHER; }, /same current base/],
  ["base ref", ({ state }) => { state.base.ref = "release"; }, /same current base/],
  ["base repository", ({ snapshot, state }) => { snapshot.base.repository = state.base.repository = "other/repo"; }, /same current base/],
  ["state stop", ({ state }) => { state.stop_reason = "needs-human"; }, /stop reason/],
  ["snapshot stop", ({ snapshot }) => { snapshot.stop_reason = "max-runtime"; }, /stop reason/],
  ["old activity", ({ state }) => { state.last_activity_at = new Date(Date.now() - 301_000).toISOString(); }, /stale/],
  ["future activity", ({ state }) => { state.last_activity_at = new Date(Date.now() + 60_000).toISOString(); }, /stale/],
  ["missing activity", ({ state }) => { delete state.last_activity_at; }, /stale/],
  ["later watch observation with the same tick", ({ snapshot }) => { snapshot.invocation_wall_elapsed_seconds -= 2; }, /predates/],
  ["mismatched observation anchor", ({ state }) => { state.started_at = new Date(0).toISOString(); }, /predates/],
]) gated(`CE ${name} mismatch refuses`, () => {
  refused(run(bash(fullMerge), { mutate: change }), reason);
});

for (const [field, value] of [
  ["pr_state", "MERGED"], ["pr_is_draft", true], ["mergeability_certain", false],
  ["mergeable", "UNKNOWN"], ["merge_state_status", "UNKNOWN"],
  ["checks_terminal", false], ["has_failing_checks", true], ["checks_awaiting_approval", 1],
  ["blocked_external", true], ["all_checks_ok", false], ["checks_present", undefined],
  ["base_ref_blocker", "probe-error"], ["stack_blocker", {}],
  ["branch_currency_blocker", {}], ["unrequested_base_merge", {}],
  ["unrequested_base_merge_pending", true], ["open_needs_human", 1],
  ["needs_human_residuals", [{ type: "choice" }]], ["needs_human_ids", ["id"]],
]) gated(`CE ${field} stop condition refuses`, () => {
  refused(run(bash(fullMerge), { mutate: ({ snapshot }) => { snapshot[field] = value; } }));
});

for (const field of ["ci", "threads", "comments", "needs_human"]) gated(`CE actionable count ${field} refuses`, () => {
  refused(run(bash(fullMerge), { mutate: ({ snapshot }) => { snapshot.counts[field] = 1; } }), /unresolved work/);
});
for (const field of ["ci", "threads", "comments"]) gated(`CE actionable ${field} array cannot be hidden by zero counts`, () => {
  refused(run(bash(fullMerge), { mutate: ({ snapshot }) => { snapshot.actionable[field] = [{}]; } }), /unresolved work/);
});

gated("missing computed flags cannot read as successful CE output", () => {
  for (const field of ["checks_terminal", "blocked_external", "base_ref_blocker", "open_needs_human", "unrequested_base_merge_pending"]) {
    refused(run(bash(fullMerge), { mutate: ({ snapshot }) => { delete snapshot[field]; } }));
  }
});

gated("non-regular or oversized CE files refuse without blocking on a FIFO", () => {
  for (const kind of ["fifo", "directory", "oversized"]) {
    const started = Date.now();
    const result = run(bash(fullMerge), { prepareFiles: ({ snapshotPath }) => {
      if (kind === "oversized") truncateSync(snapshotPath, 8 * 1024 * 1024 + 1);
      else {
        rmSync(snapshotPath);
        if (kind === "directory") mkdirSync(snapshotPath);
        else assert.equal(spawnSync("mkfifo", [snapshotPath]).status, 0);
      }
    } });
    refused(result, /regular JSON file/);
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(result.calls, []);
  }
});

for (const [name, change] of [
  ["head", (live) => { live.headRefOid = OTHER; }],
  ["current base", (live) => { live.baseRef.target.oid = OTHER; }],
  ["base ref", (live) => { live.baseRefName = "release"; }],
  ["missing current base even with historical oid", (live) => { live.baseRefOid = BASE; delete live.baseRef; }],
  ["PR identity", (live) => { live.url = live.url.replace("/7", "/8"); }],
  ["terminal PR", (live) => { live.state = "MERGED"; }],
  ["draft PR", (live) => { live.isDraft = true; }],
  ["unknown mergeability", (live) => { live.mergeable = "UNKNOWN"; }],
  ["non-clean status", (live) => { live.mergeStateStatus = "BLOCKED"; }],
]) gated(`live ${name} invalidates CE evidence`, () => {
  refused(run(bash(fullMerge), { mutate: ({ live }) => change(live) }), /live PR/);
});

gated("GitHub errors and malformed responses fail closed", () => {
  for (const fixtures of [{ fail: true }, { graphql: "not JSON" }, { graphql: JSON.stringify({ errors: [{ message: "unavailable" }], data: null }) }]) {
    refused(run(bash(fullMerge), fixtures));
  }
});

gated("a hung identity query refuses within the native five-second hook cap", () => {
  const started = Date.now();
  refused(run(bash(fullMerge), { sleep: "4" }));
  assert.ok(Date.now() - started < 5000);
});

gated("the merge must atomically pin the full CE head", () => {
  for (const suffix of ["", `--match-head-commit ${OTHER}`, `--match-head-commit ${HEAD.slice(0, 7)}`]) {
    const result = run(bash(`gh pr merge ${URL} --squash ${suffix}`));
    refused(result, /must pin CE's head/);
    assert.deepEqual(result.calls, []);
  }
});

gated("--auto cannot schedule a future merge against a point-in-time CE result", () => {
  refused(run(bash(`${fullMerge} --auto`)), /--auto can queue/);
  allowed(run(bash(`${fullMerge} --auto=false`)));
});

gated("REST merge accepts exactly one literal head sha in either field order", () => {
  for (const flags of [`-f sha=${HEAD} -f merge_method=squash`, `-f merge_method=squash --raw-field=sha=${HEAD}`, `-Fsha=${HEAD}`]) {
    allowed(run(bash(`gh api -X PUT repos/novotnyllc/railyard/pulls/7/merge ${flags}`)));
  }
});

gated("REST head proof refuses missing, duplicate, dynamic or file-based sha", () => {
  for (const flags of ["", `-f sha=${HEAD} -f sha=${HEAD}`, "-f sha=$HEAD", `--input payload.json -f sha=${HEAD}`]) {
    refused(run(bash(`gh api -X PUT repos/novotnyllc/railyard/pulls/7/merge ${flags}`)), /literal sha/);
  }
});

gated("GraphQL request files expose merges in JSON input and typed query fields", () => {
  const mutation = 'mutation { mergePullRequest(input:{pullRequestId:"PR_fixture"}) { clientMutationId } }';
  for (const shape of ["input", "field", "attached-field"]) {
    const result = run((snapshotPath) => {
      const directory = path.dirname(snapshotPath);
      const option = shape === "input" ? `--input '${directory}/request.json'`
        : shape === "field" ? `-F 'query=@${directory}/request.graphql'`
        : `--field='query=@${directory}/request.graphql'`;
      return bash(`gh api graphql ${option}`);
    }, { noPath: true, prepareFiles: ({ snapshotPath }) => {
      const directory = path.dirname(snapshotPath);
      writeFileSync(path.join(directory, "request.json"), JSON.stringify({ query: mutation }));
      writeFileSync(path.join(directory, "request.graphql"), mutation);
    } });
    refused(result, /mergePullRequest is unsupported/);
    assert.deepEqual(result.calls, []);
  }
});

gated("GraphQL request files preserve known read-only and non-merge mutations", () => {
  for (const query of [
    'query($owner:String!) { repository(owner:$owner,name:"fixture") { name } }',
    'mutation { addComment(input:{subjectId:"PR_fixture",body:"mergePullRequest"}) { clientMutationId } }',
  ]) {
    for (const shape of ["json", "query"]) {
      allowed(run((snapshotPath) => {
        const directory = path.dirname(snapshotPath);
        return bash(shape === "json" ? `gh api graphql --input '${directory}/request.json'`
          : `gh api graphql -F 'query=@${directory}/request.graphql'`);
      }, { noPath: true, prepareFiles: ({ snapshotPath }) => {
        const directory = path.dirname(snapshotPath);
        writeFileSync(path.join(directory, "request.json"), JSON.stringify({ query }));
        writeFileSync(path.join(directory, "request.graphql"), query);
      } }), []);
    }
  }
});

gated("literal GraphQL fragments may precede read-only or merge operations", () => {
  allowed(run(bash("gh api graphql -f 'query=fragment ViewerFields on User { login } query { viewer { ...ViewerFields } }'"), { noPath: true }), []);
  const result = run(bash('gh api graphql -f \'query=fragment MergeFields on Mutation { mergePullRequest(input:{pullRequestId:"PR_fixture"}) { clientMutationId } } mutation { ...MergeFields }\''), { noPath: true });
  refused(result, /mergePullRequest is unsupported/);
  assert.deepEqual(result.calls, []);
});

gated("unresolved API query and PUT endpoint content refuses without shell evaluation", () => {
  for (const command of [
    'gh api graphql -f "query=$QUERY"',
    "gh api graphql --input -",
    'gh api graphql --input "$REQUEST_FILE"',
    'gh api graphql -F "query=@${QUERY_FILE}"',
    'gh api "$ENDPOINT" -X PUT',
    'gh api -X PUT "repos/novotnyllc/railyard/pulls/$PR/merge"',
  ]) {
    const result = run(bash(command), { noPath: true });
    refused(result, /unresolved/);
    assert.deepEqual(result.calls, []);
  }
  allowed(run(bash("gh api -X PUT repos/novotnyllc/railyard/contents/file.txt -f content=fixture"), { noPath: true }), []);
});

gated("GraphQL missing, oversized and FIFO inputs refuse before any request", () => {
  for (const shape of ["missing", "oversized", "fifo"]) {
    const started = Date.now();
    const result = run((snapshotPath) => bash(`gh api graphql -F 'query=@${path.dirname(snapshotPath)}/query.graphql'`), {
      noPath: true,
      prepareFiles: ({ snapshotPath }) => {
        const filename = path.join(path.dirname(snapshotPath), "query.graphql");
        if (shape === "oversized") { writeFileSync(filename, ""); truncateSync(filename, 8 * 1024 * 1024 + 1); }
        else if (shape === "fifo") assert.equal(spawnSync("mkfifo", [filename]).status, 0);
      },
    });
    refused(result, /GraphQL query file is unreadable/);
    assert.ok(Date.now() - started < 2000);
    assert.deepEqual(result.calls, []);
  }
});

// Preserve the mature shell parser's command, quote, wrapper, grouping and
// selector regressions. These valid pinned commands must reach live identity.
const parserCommands = [
  `gh pr merge 7 --squash ${PIN}`,
  `gh pr merge --squash ${PIN}`,
  `gh --repo novotnyllc/railyard pr merge 7 ${PIN}`,
  `gh -R novotnyllc/railyard pr merge 7 ${PIN}`,
  `gh pr merge --repo=novotnyllc/railyard 7 ${PIN}`,
  `gh -Rnovotnyllc/railyard pr merge 7 ${PIN}`,
  `/opt/homebrew/bin/gh pr merge 7 ${PIN}`,
  `GH_REPO=novotnyllc/railyard gh pr merge 7 ${PIN}`,
  `env GH_REPO=novotnyllc/railyard gh pr merge 7 ${PIN}`,
  `(gh pr merge 7 ${PIN})`,
  `{ gh pr merge 7 ${PIN}; }`,
  `if gh pr merge 7 ${PIN}; then echo merged; fi`,
  `case yes in yes) gh pr merge 7 ${PIN};; esac`,
  `echo $(gh pr merge 7 ${PIN})`,
  `echo "$(gh pr merge 7 ${PIN})"`,
  `echo \`gh pr merge 7 ${PIN}\``,
  `echo "\`gh pr merge 7 ${PIN}\`"`,
  `command -p gh pr merge 7 ${PIN}`,
  `timeout 60 gh pr merge 7 ${PIN}`,
  `gh pr merge 7 --body --help ${PIN}`,
  `gh pr merge 7 --body "normal text --help" ${PIN}`,
  `gh pr merge 7 --body "text \\" --help" ${PIN}`,
  `gh pr merge -A dev@example.com 7 ${PIN}`,
  `echo preparing\ngh pr merge 7 ${PIN}`,
  `gh pr merge \\\n7 ${PIN}`,
  `cat <<<hello\ngh pr merge 7 ${PIN}`,
  `env -u GH_HOST gh pr merge 7 ${PIN}`,
  `gh api -iXPUT repos/novotnyllc/railyard/pulls/7/merge -f sha=${HEAD}`,
  `gh api -X PUT repos/{owner}/{repo}/pulls/7/merge -f sha=${HEAD}`,
  `gh api -X PUT repos/novotnyllc/railyard/pulls/7/merge --jq --help -f sha=${HEAD}`,
];
for (const [index, command] of parserCommands.entries()) gated(`pinned shell parser regression ${index + 1}`, () => {
  const result = run(bash(command));
  assert.equal(result.code, 0, `${command}\n${result.err}`);
  assert.equal(result.err, "");
  assert.equal(result.calls.at(-1), "api graphql");
});

gated("decoy prose and unrelated repo flags cannot select the merge target", () => {
  for (const prefix of ['git commit -m "docs: gh pr merge 5 workflow"', 'printf "x && gh pr merge 5"', 'gh issue list --repo attacker/decoy']) {
    const result = run(bash(`${prefix} && gh pr merge 8 ${PIN}`), { url: URL.replace("/7", "/8") });
    allowed(result, ["pr view", "api graphql"]);
    assert.match(result.args, /number=8/);
  }
});

gated("an explicit PR target cannot borrow another PR's CE evidence", () => {
  refused(run(bash(`gh pr merge https://github.com/novotnyllc/railyard/pull/8 ${PIN}`)), /not the selected PR #8/);
});

gated("REST header prose cannot become the endpoint", () => {
  const result = run(bash(`gh api -H 'X-Test: repos/decoy/settled/pulls/5/merge' -X PUT repos/novotnyllc/railyard/pulls/8/merge -f sha=${HEAD}`), { url: URL.replace("/7", "/8") });
  allowed(result);
  assert.match(result.args, /number=8/);
});

gated("one CE snapshot cannot authorize several merge commands", () => {
  const result = run(bash(`${fullMerge} && ${fullMerge}`));
  refused(result, /one PR per command/);
  assert.deepEqual(result.calls, []);
});

gated("unknown raw GraphQL merge and conditional cwd refuse actionably", () => {
  refused(run(bash('gh api graphql -f query=\'mutation { mergePullRequest(input:{pullRequestId:"PR_x"}){clientMutationId}}\'')), /mergePullRequest is unsupported/);
  for (const prefix of [
    "false && cd /tmp", "if true; then cd /tmp; fi",
    // A newline-separated block body has no control word in front of its cd.
    "if false; then\ncd /tmp\nfi", "while false; do\ncd /tmp\ndone", "f() {\ncd /tmp\n}",
  ]) {
    const result = run(bash(`${prefix}\n${fullMerge}`));
    refused(result, /conditional `cd`/);
    assert.deepEqual(result.calls, []);
  }
});

gated("single-quoted command substitution is literal data", () => {
  allowed(run(bash("printf '%s\\n' '$(gh pr merge 7)'"), { noPath: true }), []);
});

gated("quoted heredoc-looking text cannot hide a following merge", () => {
  for (const literal of ["'<<EOF'", '"<<EOF"']) {
    refused(run(bash(`printf '%s\\n' ${literal}\ngh pr merge 7`), { noPath: true }), LIVE_GATED);
  }
});

gated("a multiline quoted heredoc-looking literal cannot hide a following merge", () => {
  for (const quote of ["'", '"']) {
    const literal = `printf '%s\\n' ${quote}some literal text\n<<EOF\n${quote}`;
    allowed(run(bash(literal), { noPath: true }), []);
    refused(run(bash(`${literal}\ngh pr merge 7`), { noPath: true }), LIVE_GATED);
  }
});

gated("mergePullRequest prose in REST bodies or GraphQL output filters is data", () => {
  for (const command of [
    "gh api repos/example/project/issues/7/comments -f body='The mergePullRequest gate is fixed.'",
    "gh api graphql -f query='query { viewer { login } }' --jq '.mergePullRequest'",
  ]) allowed(run(bash(command), { noPath: true }), []);
});

gated("false boolean help and disable-auto flags do not hide a merge", () => {
  for (const flag of ["--help=false", "--help=0", "-h=false", "--disable-auto=false", "--disable-auto=F"]) {
    refused(run(bash(`gh pr merge 7 --squash ${flag}`), { noPath: true }), LIVE_GATED);
    allowed(run(bash(`${fullMerge} ${flag}`)));
  }
});

for (const command of [
  "git status", "gh pr view 7 --json state", "git merge origin/main",
  "gh pr merge --help", "gh pr merge -h", "gh pr merge 7 --disable-auto",
  "gh api repos/novotnyllc/railyard/pulls/7/merge", "gh api -X GET repos/novotnyllc/railyard/pulls/7/merge",
  "cat >release.sh <<'EOF'\ngh pr merge 7\nEOF",
]) gated(`non-merge command passes without CE evidence: ${command.split("\n")[0]}`, () => {
  allowed(run(bash(command), { noPath: true }), []);
});

gated("malformed or unrelated hook envelopes pass silently", () => {
  for (const input of ["not json", { tool_name: "Bash" }, null, [], { ...bash(fullMerge), hook_event_name: "PostToolUse" }]) {
    allowed(run(input, { noPath: true }), []);
  }
});

gated("canonical native Bash and legacy shell argument forms use the same contract", () => {
  for (const input of [
    bash(fullMerge),
    { tool_name: "shell", tool_input: { command: ["bash", "-lc", fullMerge] } },
    { tool_name: "local_shell", tool_input: { command: ["gh", "pr", "merge", URL, "--body", "normal text --help", "--match-head-commit", HEAD] } },
    { tool_name: "exec_command", tool_input: { cmd: fullMerge } },
    { tool_name: "unified_exec", tool_input: { input: ["bash", "-lc", fullMerge] } },
  ]) allowed(run(input));
});

gated("literal argv separators do not manufacture a merge command", () => {
  allowed(run({ tool_name: "shell", tool_input: { command: ["echo", ";", "gh", "pr", "merge", "7"] } }, { noPath: true }), []);
});

gated("enterprise host selectors and plain github.com URLs bind the correct host", () => {
  const enterprise = "https://github.example.com/owner/repo/pull/7";
  for (const command of [
    `gh -R github.example.com/owner/repo pr merge 7 ${PIN}`,
    `GH_HOST=github.example.com gh pr merge 7 ${PIN}`,
    `gh api --hostname github.example.com -X PUT repos/owner/repo/pulls/7/merge -f sha=${HEAD}`,
    `gh api --hostname github.example.com -X PUT repos/{owner}/{repo}/pulls/7/merge -f sha=${HEAD}`,
  ]) {
    const result = run(bash(command), { url: enterprise });
    assert.equal(result.code, 0, result.err);
    assert.ok(result.hosts.every((host) => host === "github.example.com"));
  }
  const publicResult = run(bash(fullMerge), { ambientHost: "github.example.com" });
  allowed(publicResult);
  assert.equal(publicResult.hosts.at(-1), "github.com");
});

gated("REST GH_REPO host does not retarget the API", () => {
  allowed(run(bash(`GH_REPO=github.example.com/foo/bar gh api -X PUT repos/novotnyllc/railyard/pulls/7/merge -f sha=${HEAD}`)));
});

gated("inline credentials and config selection reach identity reads", () => {
  const result = run(bash(`GH_TOKEN=fixture-token XDG_CONFIG_HOME=/tmp/fixture ${fullMerge}`));
  allowed(result);
  assert.equal(result.tokens.at(-1), "fixture-token");
  assert.equal(result.xdg.at(-1), "/tmp/fixture");
});

gated("env unsets remove the snapshot and mode from the command's environment", () => {
  // Without the snapshot the live path decides, and a wrapped merge is not
  // one literal command: it refuses before any read. With the snapshot still
  // set, the same pinned merge would have been allowed.
  for (const wrapper of ["env -u RAILYARD_CE_SNAPSHOT", "env -i"]) {
    const result = run(bash(`${wrapper} ${fullMerge}`));
    refused(result, /without a CE snapshot the merge must be one literal command/);
    assert.deepEqual(result.calls, []);
  }
  allowed(run(bash(`env -u RAILYARD_CE_MODE ${fullMerge}`), { mode: "unknown" }));
});

gated("a merge inside a string a shell interprets refuses; the script beside it does not", () => {
  for (const command of [
    `bash -lc '${fullMerge}'`,
    `env bash -lc 'gh pr merge 7 ${PIN}'`,
    `env -S 'gh pr merge 7 ${PIN}'`,
    `RAILYARD_CE_SNAPSHOT=/missing/ce.json bash -lc '${fullMerge}'`,
    `env -C /tmp bash -lc 'gh pr merge 7 ${PIN}'`,
    `GH_TOKEN=wrapper-token bash -lc '${fullMerge}'`,
    `eval ${fullMerge}`,
  ]) {
    const result = run(bash(command));
    refused(result, /interprets/);
    assert.deepEqual(result.calls, []);
  }
  allowed(run(bash(`RAILYARD_CE_MODE=unknown bash -lc 'echo ready'; ${fullMerge}`)));
});

gated("a relative GraphQL query file resolves in the wrapper's working directory", () => {
  const queryResult = run((filename) => bash(`env -C '${path.dirname(filename)}' gh api graphql -F query=@request.graphql`), {
    noPath: true,
    prepareFiles: ({ snapshotPath }) => writeFileSync(path.join(path.dirname(snapshotPath), "request.graphql"),
      'mutation { mergePullRequest(input:{pullRequestId:"PR_fixture"}) { clientMutationId } }'),
  });
  refused(queryResult, /mergePullRequest is unsupported/);
  assert.deepEqual(queryResult.calls, []);
});

gated("unconditional cwd and shell workdir are preserved; pipeline/subshell cwd does not leak", () => {
  const target = mkdtempSync(path.join(tmpdir(), "ce-merge-cwd-"));
  const outer = mkdtempSync(path.join(tmpdir(), "ce-merge-outer-"));
  try {
    for (const input of [
      bash(`cd ${target} && gh pr merge 7 ${PIN}`),
      bash(`env -C ${target} gh pr merge 7 ${PIN}`),
      bash(`env --chdir=${target} gh pr merge 7 ${PIN}`),
      // sudo -D/--chdir runs gh in that directory (Codex P1).
      bash(`sudo -D ${target} gh pr merge 7 ${PIN}`),
      bash(`sudo -u me --chdir=${target} gh pr merge 7 ${PIN}`),
      { ...bash(`gh pr merge 7 ${PIN}`), cwd: target },
      { tool_name: "shell", tool_input: { command: ["bash", "-lc", `gh pr merge 7 ${PIN}`], working_directory: target } },
    ]) {
      const result = run(input);
      allowed(result, ["pr view", "api graphql"]);
      assert.ok(result.cwds.every((cwd) => cwd.endsWith(path.basename(target))));
    }
    // A closed block does not taint a later literal cd.
    const afterBlock = run(bash(`if true; then\necho ready\nfi\ncd ${target} && gh pr merge 7 ${PIN}`));
    allowed(afterBlock, ["pr view", "api graphql"]);
    assert.ok(afterBlock.cwds.every((cwd) => cwd.endsWith(path.basename(target))));
    for (const command of [`(cd ${target} && echo done); gh pr merge 7 ${PIN}`, `cd ${target} | cat; gh pr merge 7 ${PIN}`]) {
      const result = run({ ...bash(command), cwd: outer });
      allowed(result, ["pr view", "api graphql"]);
      assert.ok(result.cwds.every((cwd) => cwd.endsWith(path.basename(outer))));
    }
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(outer, { recursive: true, force: true });
  }
});

gated("a bad bare-target resolution fails closed before the live identity query", () => {
  const result = run(bash(`gh pr merge 7 ${PIN}`), { view: "not json" });
  refused(result);
  assert.deepEqual(result.calls, ["pr view"]);
});

gated("complete native JSON returns a refusal while stdin remains open", async () => {
  const setup = prepare(BLOCKED);
  const child = spawn(process.execPath, [script], { env: setup.env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const completed = new Promise((resolve) => child.once("close", resolve));
  child.stdin.write(JSON.stringify(bash(fullMerge)));
  const timer = setTimeout(() => child.kill(), 2000);
  try {
    const status = await completed;
    refused(setup.finish({ status, stderr }), /mergeStateStatus BLOCKED/);
  } finally {
    clearTimeout(timer);
    child.stdin.destroy();
  }
});

gated("a gap inside partial native JSON does not skip verification", async () => {
  const setup = prepare(BLOCKED);
  const child = spawn(process.execPath, [script], { env: setup.env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  let closed = false;
  child.stderr.on("data", (data) => { stderr += data; });
  const completed = new Promise((resolve) => child.once("close", (code) => { closed = true; resolve(code); }));
  const payload = JSON.stringify(bash(fullMerge));
  child.stdin.write(payload.slice(0, 30));
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(closed, false);
  child.stdin.write(payload.slice(30));
  const timer = setTimeout(() => child.kill(), 2000);
  try {
    refused(setup.finish({ status: await completed, stderr }), /mergeStateStatus BLOCKED/);
  } finally {
    clearTimeout(timer);
    child.stdin.destroy();
  }
});

gated("the two identity read timeouts leave margin under the native hook cap", () => {
  const source = readFileSync(script, "utf8");
  const timeout = (name) => Number(source.match(new RegExp(`const ${name} = (\\d+)`))[1]);
  assert.ok(timeout("VIEW_TIMEOUT_MS") + timeout("GRAPHQL_TIMEOUT_MS") < 4000);
  assert.ok(timeout("TOTAL_BUDGET_MS") < 4500);
});

gated("the documented local verification includes the same suites as CI", () => {
  const root = new globalThis.URL("../../../", import.meta.url);
  const suites = (text) => [...text.matchAll(/plugins\/railyard\/[^\s\\]+\.test\.mjs/g)].map((match) => match[0]).sort();
  assert.deepEqual(suites(readFileSync(new globalThis.URL("AGENTS.md", root), "utf8")),
    [...new Set(suites(readFileSync(new globalThis.URL(".github/workflows/validate.yml", root), "utf8")))].sort());
});

const adminMerge = `gh pr merge ${URL} --squash --admin --delete-branch`;
const OVERRIDE = "RAILYARD_MERGE_OVERRIDE=user-approved";

function overridden(result) {
  assert.equal(result.code, 0, result.err);
  assert.match(result.err, /allowed by the user-directed override/);
  assert.deepEqual(result.calls, []);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].event, "merge-override");
  return result.records[0];
}

// Refused by the merge guard, with the override named as not applying and no record.
function notOverridden(result, reason) {
  refused(result);
  assert.match(result.err, /user-directed override did not apply/);
  if (reason) assert.match(result.err, reason);
  assert.deepEqual(result.records, []);
}

gated("an inline user-approved override allows an unpinned admin merge and records it", () => {
  const result = run({ ...bash(`${OVERRIDE} ${adminMerge}`), session_id: "session-7" }, { noPath: true, noSnapshot: true, noState: true });
  const record = overridden(result);
  assert.equal(record.session_id, "session-7");
  assert.equal(record.kind, "pr");
  assert.equal(record.target, URL);
  assert.equal(record.admin, true);
});

gated("the override applies to a merge after a cd into a known directory", () => {
  overridden(run(bash(`cd /tmp && ${OVERRIDE} gh pr merge 7 --squash --admin`), { noPath: true }));
});

gated("the override applies to a literal REST merge", () => {
  const record = overridden(run(bash(`${OVERRIDE} gh api -X PUT repos/novotnyllc/railyard/pulls/7/merge`), { noPath: true }));
  assert.equal(record.kind, "api");
});

gated("quoted keywords in a merge body do not refuse the override", () => {
  overridden(run(bash(`${OVERRIDE} gh pr merge 7 --squash --body 'for the record; while we wait'`), { noPath: true }));
});

gated("Codex's own bash -lc argv wrapper is the command text, not an interpreted string", () => {
  overridden(run({ tool_name: "shell", tool_input: { command: ["bash", "-lc", `${OVERRIDE} gh pr merge 7 --squash`] } }, { noPath: true }));
  notOverridden(run({ tool_name: "shell", tool_input: { command: ["bash", "-lc", `${OVERRIDE} bash -c 'gh pr merge 7 --squash'`] } }, { noPath: true }), /call gh directly/);
});

gated("an override that cannot be recorded does not apply", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "ce-merge-log-"));
  const blocker = path.join(dir, "file");
  writeFileSync(blocker, "");
  try {
    notOverridden(run(bash(`${OVERRIDE} gh pr merge 7 --squash`), { ...BLOCKED, runLogDir: path.join(blocker, "run-log") }), /could not be written/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("an ambient override in the hook's environment does not bypass the gate", () => {
  const setup = prepare(BLOCKED);
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(bash(adminMerge)), encoding: "utf8", timeout: 6000,
    env: { ...setup.env, RAILYARD_MERGE_OVERRIDE: "user-approved" },
  });
  refused(setup.finish(result), /mergeStateStatus BLOCKED/);
});

gated("any other override value, or an override not on the merge, is ignored", () => {
  notOverridden(run(bash(`RAILYARD_MERGE_OVERRIDE=yes ${adminMerge}`), { noPath: true }), LIVE_GATED);
  notOverridden(run(bash(`export ${OVERRIDE}; ${adminMerge}`), { noPath: true }), /literal words/);
});

gated("the override covers only its own command, not a second merge in the same text", () => {
  notOverridden(run(bash(`${OVERRIDE} ${adminMerge}; gh pr merge 8 --squash`), { noPath: true }), /one PR per command/);
});

gated("the override never covers a merge inside an interpreted string", () => {
  for (const text of [
    `${OVERRIDE} bash -lc 'gh pr merge 7 --squash --admin'`,
    `${OVERRIDE} sh -c 'gh pr merge 7 --squash'`,
    `${OVERRIDE} zsh -c "gh pr merge 7 --squash"`,
    `${OVERRIDE} bash -lc 'gh pr merge 7 --squash; gh pr merge 8 --squash'`,
    `${OVERRIDE} eval gh pr merge 7 --squash`,
    `eval '${OVERRIDE} gh pr merge 7 --squash'`,
    `${OVERRIDE} env -S 'gh pr merge 7 --squash'`,
    `${OVERRIDE} gh pr merge 7 --squash; trap 'gh pr merge 8' EXIT`,
    `${OVERRIDE} gh pr merge 7 --squash; bash <<EOF\ngh pr merge 8\nEOF`,
    `cat <<EOF >/dev/null\nnote\nEOF\n${OVERRIDE} gh pr merge 7 --squash`,
    `${OVERRIDE} gh pr merge 7 --squash <<< 'x'`,
  ]) notOverridden(run(bash(text), { noPath: true }));
});

gated("the override does not admit a raw GraphQL merge", () => {
  notOverridden(run(bash(`${OVERRIDE} gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:"PR_x"}){clientMutationId}}'`), { noPath: true }), /mergePullRequest is unsupported/);
});

gated("the override does not cover a merge site that a loop can re-run", () => {
  for (const text of [
    `${OVERRIDE} bash -lc 'for pr in 7 8; do gh pr merge "$pr" --squash --admin; done'`,
    `${OVERRIDE} bash -lc 'while read pr; do gh pr merge 7 --squash; done'`,
    `m() { ${OVERRIDE} gh pr merge 7 --squash; }; m; m`,
    `for pr in 7; do ${OVERRIDE} gh pr merge 7 --squash; done`,
    `repeat 2 do ${OVERRIDE} gh pr merge 7 --squash; done`,
    `repeat 2 ${OVERRIDE} gh pr merge 7 --squash`,
    `x=\`for i in 1 2; do :; done\`; ${OVERRIDE} gh pr merge 7 --squash`,
    `x=$(while false; do :; done); ${OVERRIDE} gh pr merge 7 --squash`,
    `f\\\nor i in 1 2; do ${OVERRIDE} gh pr merge 7 --squash; done`,
    `wh\\\nile true; do ${OVERRIDE} gh pr merge 7 --squash; done`,
    `${OVERRIDE} gh pr merge 7 --squash | xargs echo`,
  ]) notOverridden(run(bash(text), { noPath: true }));
});

gated("the override requires a literal target", () => {
  for (const text of [
    `${OVERRIDE} gh pr merge --squash --admin`,
    `${OVERRIDE} gh pr merge "$PR" --squash --admin`,
    `${OVERRIDE} gh pr merge 7 --repo "$REPO" --squash`,
    `${OVERRIDE} gh pr merge \${PR} --squash`,
    `${OVERRIDE} gh pr merge 7 --squash --body "$(cat notes)"`,
    `${OVERRIDE} gh pr merge {7,8} --squash`,
    `${OVERRIDE} gh pr merge 7 # --repo other/repo`,
    // Reproduced bypasses: an expanded GH_REPO, a REST prefix, and a backtick
    // glued to the selector that the tokenizer splits off as its own segment.
    `${OVERRIDE} GH_REPO="$R" gh pr merge 7 --squash`,
    `${OVERRIDE} GH_REPO=other/repo gh pr merge 7 --squash`,
    `${OVERRIDE} GH_HOST=github.example.com gh pr merge 7 --squash`,
    `${OVERRIDE} gh api --hostname github.example.com -X PUT repos/o/r/pulls/7/merge`,
    `${OVERRIDE} gh api -X PUT \${P}repos/o/r/pulls/7/merge`,
    `${OVERRIDE} gh api -X PUT repos/{owner}/{repo}/pulls/7/merge`,
    `${OVERRIDE} gh pr merge 7\`printf 8\` --squash`,
  ]) notOverridden(run(bash(text), { noPath: true }));
});

gated("the override requires a known working directory", () => {
  for (const text of [
    `cd "$D" && ${OVERRIDE} gh pr merge 7 --squash`,
    `cd ~/elsewhere && ${OVERRIDE} gh pr merge 7 --squash`,
    `cd - && ${OVERRIDE} gh pr merge 7 --squash`,
    `cd && ${OVERRIDE} gh pr merge 7 --squash`,
    `pushd /tmp && ${OVERRIDE} gh pr merge 7 --squash`,
    `cd /nonexistent-railyard-dir && ${OVERRIDE} gh pr merge 7 --squash`,
    `false && cd /tmp; ${OVERRIDE} gh pr merge 7 --squash`,
    `if true; then cd /tmp; fi; ${OVERRIDE} gh pr merge 7 --squash`,
  ]) notOverridden(run(bash(text), { noPath: true }));
});

gated("the override refuses --auto, which could merge a later head", () => {
  notOverridden(run(bash(`${OVERRIDE} gh pr merge 7 --squash --auto`), { noPath: true }), /--auto/);
});

gated("refusals do not advertise the override token", () => {
  const result = run(bash(adminMerge), BLOCKED);
  refused(result);
  assert.doesNotMatch(result.err, /RAILYARD_MERGE_OVERRIDE|user-approved|override/);
});

gated("eval and zsh repeat merges are gated, not skipped", () => {
  refused(run(bash(`eval gh pr merge 7 ${PIN}`), { noPath: true }), /interprets/);
  for (const text of [`repeat 2 gh pr merge 7 ${PIN}`, `noglob gh pr merge 7 ${PIN}`]) {
    refused(run(bash(text), { noPath: true }), LIVE_GATED);
  }
});

gated("a REST merge endpoint must be the whole literal path", () => {
  for (const endpoint of [
    "https://api.github.com/repos/novotnyllc/railyard/pulls/7/merge",
    "repos/novotnyllc/railyard/pulls/7/merge?x=1",
    "x/repos/novotnyllc/railyard/pulls/7/merge",
  ]) {
    refused(run(bash(`gh api -X PUT ${endpoint} -f sha=${HEAD}`)), /endpoint or method is unresolved/);
  }
  allowed(run(bash(`gh api -X PUT /repos/novotnyllc/railyard/pulls/7/merge -f sha=${HEAD}`)));
});

gated("an unresolved cd refuses the merge guard, but a subshell's cd does not leak", () => {
  refused(run(bash(`cd ~/elsewhere && ${fullMerge}`)), /unresolved or conditional `cd`/);
  allowed(run(bash(`(cd - && echo done); ${fullMerge}`)));
});

// The override is an allow-list of one command shape.
const { overrideShape } = createRequire(import.meta.url)("./merge-override.js");

gated("the override allow-list accepts only the literal merge shapes", () => {
  for (const text of [
    `${OVERRIDE} gh pr merge 7 --squash --admin`,
    `${OVERRIDE} gh pr merge feature/x-1 --repo novotnyllc/railyard --rebase`,
    `${OVERRIDE} gh pr merge https://github.com/novotnyllc/railyard/pull/7 --squash --delete-branch`,
    `${OVERRIDE} gh pr merge 7 --squash --subject 'Fix: the thing (again)' --body "for the record; while we wait"`,
    `${OVERRIDE} gh pr merge 7 --match-head-commit ${HEAD} --squash`,
    `cd /tmp && ${OVERRIDE} gh pr merge 7 --squash`,
    `RAILYARD_CE_MODE=interactive ${OVERRIDE} /opt/homebrew/bin/gh pr merge 7 --merge`,
    `${OVERRIDE} gh api -X PUT repos/novotnyllc/railyard/pulls/7/merge -f merge_method=squash -f 'commit_title=Fix it'`,
    `${OVERRIDE} gh api --method PUT /repos/novotnyllc/railyard/pulls/7/merge -f sha=${HEAD}`,
  ]) assert.ok(overrideShape(text).shape, `${text}: ${overrideShape(text).reason}`);
  for (const text of [
    // Codex review: a glob in the REST repository, expanded after validation.
    `${OVERRIDE} gh api -X PUT repos/example/*/pulls/7/merge`,
    // Thermos #8: a second merge riding along through timeout and quoting.
    `${OVERRIDE} gh pr merge 7 --admin; timeout 9 gh pr 'merge' 8 --admin`,
    `${OVERRIDE} gh pr 'merge' 7`,
    `${OVERRIDE} gh pr merge'' 7`,
    `${OVERRIDE} gh -R novotnyllc/railyard pr merge 7`,
    `${OVERRIDE} gh pr merge 7 --repo novotnyllc/*`,
    `${OVERRIDE} gh pr merge 7 --repo github.example.com/o/r`,
    `${OVERRIDE} gh pr merge ../7`,
    `${OVERRIDE} gh pr merge -7`,
    `${OVERRIDE} gh pr merge 7 8`,
    `${OVERRIDE} gh pr merge 7 --auto`,
    `${OVERRIDE} gh pr merge 7 --body-file notes.md`,
    `${OVERRIDE} gh pr merge 7 --squash --squash`,
    `FOO=1 ${OVERRIDE} gh pr merge 7`,
    `${OVERRIDE} ${OVERRIDE} gh pr merge 7`,
    `cd relative && ${OVERRIDE} gh pr merge 7`,
    `cd /tmp && cd /tmp && ${OVERRIDE} gh pr merge 7`,
    `${OVERRIDE} gh pr merge 7 && echo done`,
    `${OVERRIDE} gh pr merge 7 & echo`,
    `${OVERRIDE} gh pr merge 7 > log`,
    `${OVERRIDE} gh pr merge 7\necho`,
    `${OVERRIDE} gh pr merge ~7`,
    `${OVERRIDE} gh pr merge 7 --body "$(id)"`,
    `${OVERRIDE} gh pr merge 7 --body "a\\"b"`,
    `${OVERRIDE} gh api -X PUT repos/o/r/pulls/7/merge -F sha=@file`,
    `${OVERRIDE} gh api -X PUT repos/o/r/pulls/7/merge -f body=x`,
    `${OVERRIDE} gh api -X PUT repos/o/r/pulls/7/merge?x=1`,
    `${OVERRIDE} gh api -XPUT repos/o/r/pulls/7/merge`,
    `${OVERRIDE} gh api repos/o/r/pulls/7/merge`,
    `${OVERRIDE} gh api -X PUT repos/o/r/pulls/7/merge --hostname h`,
  ]) assert.ok(!overrideShape(text).shape, text);
  assert.equal(overrideShape(`${OVERRIDE} gh pr merge 7`).shape.kind, "pr");
});

gated("the reported override bypasses all fall back to the merge guard", () => {
  for (const text of [
    `${OVERRIDE} gh api -X PUT repos/example/*/pulls/7/merge`,
    `${OVERRIDE} gh pr merge 7 --admin; timeout 9 gh pr 'merge' 8 --admin`,
  ]) notOverridden(run(bash(text), { noPath: true }));
});

const codexArgv = (script) => ({ hook_event_name: "PreToolUse", tool_name: "shell", tool_input: { command: ["bash", "-lc", script] } });

gated("a heredoc or here-string fed to a shell is gated as commands, on both harnesses", () => {
  for (const text of [
    "bash <<EOF\ngh pr merge 7 --admin\nEOF",
    "sh -s <<'EOF'\ngh pr merge 7 --admin\nEOF",
    "source /dev/stdin <<EOF\ngh pr merge 7 --admin\nEOF",
    "bash <<< 'gh pr merge 7 --admin'",
    "echo 'gh pr merge 7 --admin' | bash",
  ]) {
    refused(run(bash(text), { noPath: true }));
    refused(run(codexArgv(text), { noPath: true }));
  }
});

gated("an arithmetic shift is not a heredoc that hides later lines", () => {
  for (const text of ["echo $((x<<y))\ngh pr merge 7 --admin", "(( x = 1 << 2 ))\ngh pr merge 7 --admin"]) {
    refused(run(bash(text), { noPath: true }), LIVE_GATED);
    refused(run(codexArgv(text), { noPath: true }), LIVE_GATED);
  }
  // A heredoc to a non-interpreter is still data.
  allowed(run(codexArgv("cat <<EOF > notes.md\ngh pr merge 7\nEOF"), { noPath: true }), []);
});

gated("merges run through command wrappers are gated", () => {
  for (const text of [
    "timeout 60 gh pr merge 7 --admin",
    "timeout -s KILL -k 5 60 gh pr merge 7 --admin",
    "nice -n 5 gh pr merge 7 --admin",
    "nohup gh pr merge 7 --admin",
    "sudo -u me gh pr merge 7 --admin",
    "env -i PATH=/bin gh pr merge 7 --admin",
    "command -p gh pr merge 7 --admin",
    "time -p gh pr merge 7 --admin",
    "echo 7 | xargs -I{} gh pr merge {} --admin",
    "echo 7 | xargs -n1 gh pr merge --admin",
    "find /tmp -maxdepth 0 -exec gh pr merge 7 --admin \\;",
    "find . -name x -print -execdir true \\; -exec gh pr 'merge' 8 {} +",
    "$(which gh) pr merge 7 --admin",
    "/opt/homebrew/bin/g[h] pr merge 7 --admin",
  ]) refused(run(bash(text), { noPath: true }));
  allowed(run(bash("timeout 60 gh pr view 7"), { noPath: true }), []);
  allowed(run(bash("find . -name '*.md' -exec grep -l merge {} +"), { noPath: true }), []);
});

gated("xargs merges refuse even with settled evidence; sudo's unknown -D refuses (Codex P1)", () => {
  // xargs appends a PR, repository or flags from stdin after the gate reads the visible ones.
  for (const text of [`echo 8 | xargs gh pr merge ${PIN}`, `echo 8 | xargs -n1 gh pr merge 7 ${PIN}`]) {
    refused(run(bash(text)), /xargs adds merge arguments/);
  }
  refused(run(bash(`sudo -D "$REPO" gh pr merge 7 ${PIN}`)), /unresolved or conditional `cd`/);
  allowed(run(bash(`echo 7 | xargs gh pr view`), { noPath: true }), []);
});

gated("a gh or git shadowed by a function or alias in the same command refuses (Codex P1)", () => {
  for (const text of [
    `gh() { "$GH_BIN" "$1" "$2" 8 --admin; }; gh pr merge 7 ${PIN}`,
    `function gh { command gh "$@"; }\ngh pr merge 7 ${PIN}`,
    `alias gh='hub'; gh pr merge 7 ${PIN}`,
  ]) refused(run(bash(text)), /redefines gh/);
  // A function that merely has gh in its name is not gh.
  allowed(run(bash(`ghx() { echo hi; }; ghx`), { noPath: true }), []);
  const { dir, git } = pushRepo();
  try {
    git("config", "railyard.guardDefaultBranchPush", "true");
    pushRefused(run({ ...bash(`git() { command git push origin HEAD:main; }; git push origin feature`), cwd: dir }, { noPath: true }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("a quoted substitution stays inside its command, and redirections are not arguments (Codex P1)", () => {
  // The enclosing gh command keeps its computed word instead of splitting.
  for (const text of [`gh "$(printf pr)" merge 7 --admin`, "gh \"`printf pr`\" merge 7 --admin"]) {
    refused(run(bash(text), { noPath: true }), /computed/);
    refused(run(codexArgv(text), { noPath: true }), /computed/);
  }
  // A redirection between words is dropped, so the merge is seen and gated.
  for (const text of ["gh pr 2>/dev/null merge 7 --admin", "gh pr &>/dev/null merge 7 --admin", "gh >log pr merge 7 --admin"]) {
    refused(run(bash(text), { noPath: true }), LIVE_GATED);
    refused(run(codexArgv(text), { noPath: true }), LIVE_GATED);
  }
  // A settled, pinned merge with redirections still verifies.
  allowed(run(bash(`${fullMerge} >merge.log 2>&1`)));
  // Redirecting to a file named pr leaves `gh merge 7`, which merges nothing.
  allowed(run(bash("gh > pr merge 7"), { noPath: true }), []);
});

gated("only a command's own argv is credited, and runtime gh aliases refuse (CodeRabbit)", () => {
  for (const text of [
    `GIT_EDITOR='gh pr merge 7 --admin #' git commit --allow-empty`,
    `GH_EDITOR='gh pr merge 7 --admin #' gh pr view 7`,
    `git grep -O'gh pr merge 7 --admin #' x`,
  ]) refused(run(bash(text), { noPath: true }), /cannot attribute/);
  for (const text of ["gh alias set p pr; gh p merge 7 --admin", "gh alias set pm 'pr merge'; gh pm 7 --admin"]) {
    refused(run(bash(text), { noPath: true }), /changes gh aliases/);
  }
  // Data stays data, and a literal inline config on a direct merge is still a plain merge.
  allowed(run(bash(`git commit --allow-empty -m "run gh pr merge 7 later"`), { noPath: true }), []);
  allowed(run(bash(`XDG_CONFIG_HOME=/tmp/elsewhere ${fullMerge}`)));
  const { dir, git } = pushRepo();
  try {
    git("config", "railyard.guardDefaultBranchPush", "true");
    for (const command of [`GIT_EDITOR='git push origin main #' git commit --allow-empty`,
      `git config alias.p '!git push origin main'`, `git filter-branch --tree-filter 'git push origin main' HEAD`]) {
      pushRefused(run({ ...bash(command), cwd: dir }, { noPath: true }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("find -exec applies the same gh checks as a top-level command (Codex P1)", () => {
  refused(run(bash(`find . -maxdepth 0 -exec xargs gh pr merge ${PIN} ';'`)), /xargs adds merge arguments/);
  refused(run(bash(`find . -maxdepth 0 -exec gh extension exec forward pr merge 7 --admin ';'`), { noPath: true }), /cannot attribute/);
  refused(run(bash(`find . -maxdepth 0 -exec gh pr merge 7 --admin ';'`), { noPath: true }), LIVE_GATED);
});

gated("-R and --repo naming different repositories refuse (Codex P1)", () => {
  refused(run(bash(`gh pr merge 7 -R approved/repo --repo target/repo ${PIN}`)), /both -R and --repo/);
  refused(run(bash(`gh pr merge 7 --repo target/repo -R approved/repo ${PIN}`)), /both -R and --repo/);
  allowed(run(bash(`gh pr merge 7 -R novotnyllc/railyard --repo novotnyllc/railyard ${PIN}`)), ["api graphql"]);
});

gated("a merge past the parser's segment or depth cap refuses instead of being skipped", () => {
  refused(run(bash(Array(600).fill("true").join(" && ") + " && gh pr merge 7 --admin"), { noPath: true }), /cannot attribute/);
  refused(run(bash(Array(40).fill("true").join("; ") + "; gh pr merge 7 --admin"), { noPath: true }), LIVE_GATED);
  let nested = "gh pr merge 7 --admin";
  for (let level = 0; level < 10; level += 1) nested = `eval ${nested}`;
  refused(run(bash(nested), { noPath: true }), /interprets/);
  allowed(run(bash(Array(600).fill("true").join(" && ")), { noPath: true }), []);
});

// Round-2 probes (probes-r2/h1, h2, w1, b1, m1-shells, verify, f1). Every
// merge the parser cannot attribute to one directly executed gh command
// refuses, on Claude Code's string and on Codex's outer `bash -lc` argv.
const ADMIN = "gh pr merge 7 --admin";
const unattributable = {
  "delimiter EOF-1": `cat <<EOF-1\nnotes\nEOF-1\n${ADMIN}\nEOF`,
  "delimiter EOF-1 closing early": `cat <<EOF-1\nEOF\n${ADMIN}\nEOF-1`,
  "delimiter E'OF'": `cat <<E'OF'\nnotes\nEOF\n${ADMIN}\nE`,
  "old arithmetic $[1<<x]": `x=1; echo $[1<<x]\n${ADMIN}\nx`,
  "arithmetic $((x<<y))": `echo $((x<<y))\n${ADMIN}`,
  "heredoc piped to bash": `cat <<'EOF' | bash\n${ADMIN}\nEOF`,
  "heredoc to bash": `bash <<EOF\n${ADMIN}\nEOF`,
  "heredoc to ksh": `ksh <<EOF\n${ADMIN}\nEOF`,
  "redirection first": `<<EOF bash\n${ADMIN}\nEOF`,
  "$SHELL heredoc": `$SHELL <<EOF\n${ADMIN}\nEOF`,
  "eval of a heredoc": `eval "$(cat <<'EOF'\n${ADMIN}\nEOF\n)"`,
  "source process substitution": `source <(cat <<'EOF'\n${ADMIN}\nEOF\n)`,
  "bash process substitution": `bash <(cat <<'EOF'\n${ADMIN}\nEOF\n)`,
  "xargs heredoc": `xargs -L1 gh <<'EOF'\npr merge 7 --admin\nEOF`,
  "tee a file then run it": `tee /tmp/x.sh <<'EOF' >/dev/null\n${ADMIN}\nEOF\nbash /tmp/x.sh`,
  "write a file then run it by path": `cat > x.sh <<'EOF'\n${ADMIN}\nEOF\n./x.sh`,
  "here-string to bash": `bash <<< '${ADMIN}'`,
  "pipe into sh /dev/stdin": `echo '${ADMIN}' | sh /dev/stdin`,
  "pipe into bash -s": `echo '${ADMIN}' | bash -s -- x`,
  "ksh -c": `ksh -c '${ADMIN}'`,
  "fish -c": `fish -c '${ADMIN}'`,
  "dash -c": `dash -c '${ADMIN}'`,
  "bash -o pipefail -c": `bash -o pipefail -c '${ADMIN}'`,
  "bash -O extglob -c": `bash -O extglob -c '${ADMIN}'`,
  "bash -euc": `bash -euc '${ADMIN}'`,
  "find -exec sh -c": `find . -maxdepth 0 -exec sh -c '${ADMIN}' ';'`,
  "op run --": `op run -- ${ADMIN}`,
  "arch": `arch -arm64 ${ADMIN}`,
  "stdbuf": `stdbuf -oL ${ADMIN}`,
  "doas": `doas ${ADMIN}`,
  "flock": `flock /tmp/l ${ADMIN}`,
  "mise exec": `mise exec -- ${ADMIN}`,
  "direnv exec": `direnv exec . ${ADMIN}`,
  "script -q": `script -q /dev/null ${ADMIN}`,
  "watch": `watch -n 1 ${ADMIN}`,
  "ssh": `ssh host '${ADMIN}'`,
  "trap": `trap '${ADMIN}' EXIT`,
  "parallel": `parallel gh pr merge ::: 7`,
  "coproc": `coproc ${ADMIN}`,
  "shell function": `f(){ gh "$@"; }; f pr merge 7`,
  "variable command": `G=gh; $G pr merge 7`,
  "zsh =gh": `=gh pr merge 7`,
  "alias then use": `alias g=gh\ng pr merge 7`,
  "gh pr with IFS": "gh pr${IFS}merge 7",
  "quoted merge word through timeout": `timeout 9 gh pr 'merge' 8 --admin`,
  "python heredoc": `python3 - <<'EOF'\nprint('gh pr merge 7')\nEOF`,
  "long chain": Array(600).fill("true").join(" && ") + ` && ${ADMIN}`,
};
gated("merges the parser cannot attribute refuse on both harnesses", () => {
  for (const [name, text] of Object.entries(unattributable)) {
    for (const input of [bash(text), codexArgv(text)]) {
      const result = run(input, { noPath: true });
      assert.equal(result.code, 2, `${name}: ${result.err}`);
      assert.deepEqual(result.calls, [], name);
    }
  }
});

gated("data that only mentions merging passes on both harnesses", () => {
  const long = Array.from({ length: 600 }, (_, i) => `echo line${i}`).join("\n") + "\ngit merge --ff-only origin/main";
  for (const text of [
    "git merge --no-ff feature",
    "gh pr view 7 --json mergeable,mergeStateStatus",
    "grep -rn 'gh pr merge' docs/",
    "grep -rn 'gh pr merge' docs/ | head -5",
    "gh pr merge --help",
    "gh pr merge 7 --disable-auto",
    "cat > notes.md <<'EOF'\nrun gh pr merge 7 --admin later\nEOF",
    "cat > notes.md <<\\EOF\ngh pr merge 7\nEOF",
    "grep -e . <<'EOF'\ngh pr merge 7\nEOF",
    "git commit -F - <<'EOF'\nfix: gate gh pr merge shapes\nEOF",
    "git commit -m 'docs: gh pr merge workflow'",
    "gh pr create --title t --body-file - <<'EOF'\nThis PR fixes gh pr merge gating\nEOF",
    "printf '%s\\n' '$(gh pr merge 7)'",
    long,
    "git merge-base HEAD main; curl -fsSL https://example.com/install.sh | sh",
    "gh api repos/o/r/pulls/7/merge",
    "echo y | gh pr view 7",
  ]) {
    allowed(run(bash(text), { noPath: true }), []);
    allowed(run(codexArgv(text), { noPath: true }), []);
  }
});

gated("Codex's outer shell argv forms are the command text", () => {
  for (const options of [["-c"], ["-lc"], ["-euc"], ["-eu", "-o", "pipefail", "-c"]]) {
    allowed(run({ tool_name: "shell", tool_input: { command: ["bash", ...options, fullMerge] } }));
    allowed(run({ tool_name: "shell", tool_input: { command: ["/bin/zsh", ...options, fullMerge] } }));
    overridden(run({ tool_name: "shell", tool_input: { command: ["bash", ...options, `${OVERRIDE} gh pr merge 7 --squash`] } }, { noPath: true }));
  }
  const pinned = `RAILYARD_CE_MODE=pipeline gh pr merge 7 --repo novotnyllc/railyard --squash ${PIN}`;
  allowed(run((filename) => bash(`RAILYARD_CE_SNAPSHOT=${filename} ${pinned}`), { noPath: true }));
  allowed(run((filename) => codexArgv(`RAILYARD_CE_SNAPSHOT=${filename} ${pinned}`), { noPath: true }));
});

gated("a cd behind command or builtin moves the merge's directory (Codex P1)", () => {
  const target = mkdtempSync(path.join(tmpdir(), "ce-merge-cmdcd-"));
  try {
    for (const prefix of ["command cd", "builtin cd", "command -p cd"]) {
      const result = run(bash(`${prefix} ${target} && gh pr merge 7 ${PIN}`));
      allowed(result, ["pr view", "api graphql"]);
      assert.ok(result.cwds.every((cwd) => cwd.endsWith(path.basename(target))), prefix);
    }
    refused(run(bash(`timeout 5 cd ${target}; gh pr merge 7 ${PIN}`)), /unresolved or conditional `cd`/);
    refused(run(bash(`source ./env.sh; gh pr merge 7 ${PIN}`)), /unresolved or conditional `cd`/);
  } finally {
    rmSync(target, { recursive: true, force: true });
  }
});

gated("a cd inside a heredoc-fed shell does not leak into the outer merge (Codex P1)", () => {
  const other = mkdtempSync(path.join(tmpdir(), "ce-merge-other-"));
  const outer = mkdtempSync(path.join(tmpdir(), "ce-merge-outer-"));
  try {
    for (const text of [`bash <<EOF\ncd ${other}\nEOF\ngh pr merge 7 ${PIN}`, `bash -c 'cd ${other}'; gh pr merge 7 ${PIN}`]) {
      const result = run({ ...bash(text), cwd: outer });
      allowed(result, ["pr view", "api graphql"]);
      assert.ok(result.cwds.every((cwd) => cwd.endsWith(path.basename(outer))), text);
    }
  } finally {
    rmSync(other, { recursive: true, force: true });
    rmSync(outer, { recursive: true, force: true });
  }
});

gated("a gh alias that expands to a merge is gated", () => {
  const withAliases = (text) => ({
    noPath: true,
    prepareFiles: ({ snapshotPath }) => {
      const dir = path.join(path.dirname(snapshotPath), "gh-config");
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "config.yml"), text);
    },
  });
  const config = "version: 1\naliases:\n    pm: pr merge\n    co: pr checkout\n    sm: '!gh pr merge \"$1\" --admin'\ngit_protocol: https\n";
  refused(run(bash("gh pm 7 --admin"), withAliases(config)), LIVE_GATED);
  refused(run(bash("gh sm 7"), withAliases(config)), /alias runs a merge/);
  // A multi-word alias under a built-in is matched by its whole name, the
  // longest one winning (Codex P1).
  const multi = config.replace("git_protocol: https\n",
    "    pr land: pr merge\n    'pr land safe': pr view\n    \"issue mine\": issue list --author @me\n");
  for (const text of ["gh pr land 7 --admin", "gh pr land --admin 7"]) {
    refused(run(bash(text), withAliases(multi)), LIVE_GATED);
  }
  allowed(run(bash("gh pr land safe 7"), withAliases(multi)), []);
  allowed(run(bash("gh issue mine"), withAliases(multi)), []);
  // The alias is found past gh's options (Codex P1).
  for (const text of ["gh -R owner/repo pm 7 --admin", "gh --repo=owner/repo pm 7 --admin"]) {
    refused(run(bash(text), withAliases(config)), LIVE_GATED);
  }
  // An extension receives every argument, so a merge phrase passed to it is not data (Codex P1).
  for (const text of ["gh extension exec forward pr merge 7 --admin", "gh forward pr merge 7 --admin"]) {
    refused(run(bash(text), withAliases(config)), /cannot attribute/);
  }
  allowed(run(bash(`gh pr comment 7 --body "merge after gh pr merge 6"`), withAliases(config)), []);
  // A shell alias whose text holds no merge runs like any command. One that
  // builds a merge word at run time is deliberate obfuscation, outside the
  // documented scope (ce-merge-guard.md).
  const listing = config.replace("git_protocol: https\n", "    mine: '!gh pr list --author @me'\n");
  allowed(run(bash("gh mine"), withAliases(listing)), []);
  allowed(run(bash("gh co 7"), withAliases(config)), []);
  // An unreadable config never blocks a non-merge command.
  allowed(run(bash("gh pm 7"), withAliases("aliases: [not: yaml")), []);
});

gated("gh aliases come from the config directory the command itself selects (Codex P1)", () => {
  const other = mkdtempSync(path.join(tmpdir(), "ce-gh-config-"));
  try {
    writeFileSync(path.join(other, "config.yml"), "aliases:\n    boom: pr merge\n");
    for (const text of [`GH_CONFIG_DIR=${other} gh boom 7 --admin`, `export GH_CONFIG_DIR=${other}; gh boom 7 --admin`,
      `XDG_CONFIG_HOME=${path.dirname(other)} GH_CONFIG_DIR= gh pr view 1; GH_CONFIG_DIR=${other} gh boom 7`]) {
      refused(run(bash(text), { noPath: true }), LIVE_GATED);
    }
    refused(run(bash(`GH_CONFIG_DIR="$CFG" gh boom 7`), { noPath: true }), /cannot resolve/);
    // gh's own commands cannot be aliased, so an unknown config does not matter to them.
    allowed(run(bash(`GH_CONFIG_DIR="$CFG" gh pr view 7`), { noPath: true }), []);
  } finally {
    rmSync(other, { recursive: true, force: true });
  }
});

gated("exported GitHub routing and a backgrounded cd follow the shell's scoping (Codex P1)", () => {
  const target = mkdtempSync(path.join(tmpdir(), "ce-merge-bg-"));
  const outer = mkdtempSync(path.join(tmpdir(), "ce-merge-outer-"));
  try {
    // export GH_REPO / GH_HOST reach the merge; the identity query follows them.
    const exported = run(bash(`export GH_REPO=novotnyllc/railyard; gh pr merge 7 ${PIN}`));
    allowed(exported, ["api graphql"]);
    // A conditional export leaves the repository unknown, so the lookup cannot be trusted.
    refused(run(bash(`false && export GH_REPO=other/repo; gh pr merge 7 ${PIN}`)));
    // `cd x &` runs in a background subshell: the merge stays in the original directory.
    const result = run({ ...bash(`cd ${target} & gh pr merge 7 ${PIN}`), cwd: outer });
    allowed(result, ["pr view", "api graphql"]);
    assert.ok(result.cwds.every((cwd) => cwd.endsWith(path.basename(outer))));
    // A subshell's export does not leak.
    allowed(run(bash(`(export GH_REPO=other/repo); ${fullMerge}`)));
  } finally {
    rmSync(target, { recursive: true, force: true });
    rmSync(outer, { recursive: true, force: true });
  }
});

// A throwaway repository whose origin/HEAD names main.
function pushRepo() {
  const dir = mkdtempSync(path.join(tmpdir(), "ce-push-guard-"));
  const git = (...args) => spawnSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "init");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  return { dir, git };
}
const pushRefused = (result) => {
  assert.equal(result.code, 2, result.err);
  assert.match(result.err, /Push refused: this repository guards its default branch/);
};

gated("pushes to the default branch are gated only where the guard is on", () => {
  const { dir, git } = pushRepo();
  try {
    const at = (command) => ({ ...bash(command), cwd: dir });
    // Off by default: the owner pushes some repositories to main directly.
    allowed(run(at("git push origin HEAD:main"), { noPath: true }), []);
    pushRefused(run(at("RAILYARD_GUARD_DEFAULT_BRANCH_PUSH=1 git push origin HEAD:main"), { noPath: true }));
    git("config", "railyard.guardDefaultBranchPush", "true");
    for (const command of ["git push origin HEAD:main", "git push", "git push origin main", "git push --force origin +main",
      "git push origin HEAD:refs/heads/main", "git push --all origin", `git -C ${dir} push origin main`]) {
      pushRefused(run(at(command), { noPath: true }));
    }
    for (const command of ["git push origin HEAD:feature", "git push --dry-run origin main", "git push origin feature"]) {
      allowed(run(at(command), { noPath: true }), []);
    }
    git("checkout", "-q", "-b", "feature");
    allowed(run(at("git push"), { noPath: true }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("push-guard: an implicit push refuses unless its configured destination is provably not the default", () => {
  const { dir, git } = pushRepo();
  try {
    const at = (command) => ({ ...bash(command), cwd: dir });
    git("config", "railyard.guardDefaultBranchPush", "true");
    git("checkout", "-q", "-b", "feature");
    git("config", "remote.origin.push", "HEAD:refs/heads/main");
    for (const command of ["git push origin", "git push", "git push origin feature"]) pushRefused(run(at(command), { noPath: true }));
    git("config", "--unset", "remote.origin.push");
    git("config", "branch.feature.remote", "origin");
    git("config", "branch.feature.merge", "refs/heads/main");
    // simple (the default) and current push feature to feature.
    allowed(run(at("git push"), { noPath: true }), []);
    git("config", "push.default", "current");
    allowed(run(at("git push origin"), { noPath: true }), []);
    for (const mode of ["upstream", "tracking", "matching"]) {
      git("config", "push.default", mode);
      pushRefused(run(at("git push"), { noPath: true }));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("push-guard: a push inside a script, heredoc, pipe or wrapper refuses when enabled", () => {
  const { dir, git } = pushRepo();
  try {
    const at = (command) => ({ ...bash(command), cwd: dir });
    const hidden = [
      `bash -lc "git push origin HEAD:main"`,
      `sh -c 'git push origin feature'`,
      `bash <<EOF\ngit push origin main\nEOF`,
      `echo 'git push origin main' | bash`,
      `find . -maxdepth 0 -exec git push origin main ';'`,
      `echo main | xargs git push origin`,
      `eval git push origin main`,
    ];
    // Off by default: nothing is refused.
    for (const command of hidden) allowed(run(at(command), { noPath: true }), []);
    pushRefused(run(at(`RAILYARD_GUARD_DEFAULT_BRANCH_PUSH=1 bash -lc "git push origin HEAD:main"`), { noPath: true }));
    git("config", "railyard.guardDefaultBranchPush", "true");
    for (const command of hidden) pushRefused(run(at(command), { noPath: true }));
    // Text that only mentions a push is still data.
    for (const command of [`git commit --allow-empty -m "document git push"`, `git checkout -b push-fix`, `grep -n "git push" README.md`]) {
      allowed(run(at(command), { noPath: true }), []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("push-guard: --git-dir, --work-tree and GIT_DIR select the repository whose opt-in applies", () => {
  const { dir, git } = pushRepo();
  const outside = mkdtempSync(path.join(tmpdir(), "ce-push-outside-"));
  try {
    const at = (command) => ({ ...bash(command), cwd: outside });
    git("config", "railyard.guardDefaultBranchPush", "true");
    for (const command of [
      `git --git-dir=${dir}/.git push origin HEAD:main`,
      `git --git-dir ${dir}/.git --work-tree ${dir} push origin main`,
      `GIT_DIR=${dir}/.git git push origin main`,
    ]) pushRefused(run(at(command), { noPath: true }));
    // A repository this hook cannot resolve is not opted in, so the push runs
    // unless the environment turns the guard on.
    for (const command of [`git --git-dir="$D" push origin HEAD:main`, `git --git-dir=${outside}/missing push origin HEAD:main`,
      `git -C "$D" push origin main`, `git -C ${outside}/missing push origin main`, `cd "$D" && git push origin main`]) {
      allowed(run(at(command), { noPath: true }), []);
      pushRefused(run(at(`export RAILYARD_GUARD_DEFAULT_BRANCH_PUSH=1; ${command}`), { noPath: true }));
    }
    allowed(run(at(`git --git-dir=${dir}/.git push origin HEAD:feature`), { noPath: true }), []);
    git("config", "--unset", "railyard.guardDefaultBranchPush");
    allowed(run(at(`git --git-dir=${dir}/.git push origin HEAD:main`), { noPath: true }), []);
    // No named repository and none here: not opted in.
    allowed(run(at("git push origin HEAD:main"), { noPath: true }), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

gated("push-guard: an exported opt-in holds, and an unknown remote default refuses (Codex P1)", () => {
  const { dir, git } = pushRepo();
  try {
    const at = (command) => ({ ...bash(command), cwd: dir });
    git("checkout", "-q", "-b", "feature");
    pushRefused(run(at("export RAILYARD_GUARD_DEFAULT_BRANCH_PUSH=1; git push origin main"), { noPath: true }));
    pushRefused(run(at("RAILYARD_GUARD_DEFAULT_BRANCH_PUSH=1\ngit push origin HEAD:main"), { noPath: true }));
    allowed(run(at("export RAILYARD_GUARD_DEFAULT_BRANCH_PUSH=1; git push origin feature"), { noPath: true }), []);
    git("config", "railyard.guardDefaultBranchPush", "true");
    // A URL or a remote with no recorded default cannot be checked.
    for (const command of ["git push https://example.com/o/r.git HEAD:release", "git push upstream HEAD:release"]) {
      const result = run(at(command), { noPath: true });
      pushRefused(result);
      assert.match(result.err, /default branch of .* is unknown/);
    }
    git("symbolic-ref", "--delete", "refs/remotes/origin/HEAD");
    pushRefused(run(at("git push origin feature"), { noPath: true }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("push-guard: --signed is a boolean and matching refspecs refuse", () => {
  const { dir, git } = pushRepo();
  try {
    const at = (command) => ({ ...bash(command), cwd: dir });
    git("config", "railyard.guardDefaultBranchPush", "true");
    git("checkout", "-q", "-b", "feature");
    for (const command of ["git push --signed origin main", "git push --signed=if-asked origin main",
      "git push origin :", "git push origin +:", "git push --force origin feature :"]) {
      pushRefused(run(at(command), { noPath: true }));
    }
    for (const command of ["git push --signed origin feature", "git push --signed=if-asked origin HEAD:feature"]) {
      allowed(run(at(command), { noPath: true }), []);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("GraphQL mergePullRequest refuses, even in a query file", () => {
  refused(run(bash(`gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:"PR_x"}){clientMutationId}}'`), { noPath: true }), /mergePullRequest is unsupported/);
  refused(run(codexArgv(`gh api graphql -f query='mutation { mergePullRequest(input:{pullRequestId:"PR_x"}){clientMutationId}}'`), { noPath: true }), /mergePullRequest is unsupported/);
});
