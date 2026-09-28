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
  "api graphql") printf '%s' "$GH_FIXTURE_GRAPHQL" ;;
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
    GH_FIXTURE_FAIL: fixtures.fail ? "1" : "", GH_FIXTURE_SLEEP: fixtures.sleep ?? "",
    // Override records land here, never in the developer's own state dir.
    RAILYARD_RUN_LOG_DIR: fixtures.runLogDir ?? path.join(dir, "run-log"),
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

for (const [name, fixtures, reason] of [
  ["missing snapshot path", { noPath: true }, /RAILYARD_CE_SNAPSHOT/],
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
  `bash -lc 'gh pr merge 7 ${PIN}'`,
  `env bash -lc 'gh pr merge 7 ${PIN}'`,
  `env -S 'gh pr merge 7 ${PIN}'`,
  `(gh pr merge 7 ${PIN})`,
  `{ gh pr merge 7 ${PIN}; }`,
  `if gh pr merge 7 ${PIN}; then echo merged; fi`,
  `case yes in yes) gh pr merge 7 ${PIN};; esac`,
  `echo $(gh pr merge 7 ${PIN})`,
  `echo "$(gh pr merge 7 ${PIN})"`,
  `echo \`gh pr merge 7 ${PIN}\``,
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
  for (const prefix of ["false && cd /tmp", "if true; then cd /tmp; fi"]) {
    const result = run(bash(`${prefix}; ${fullMerge}`));
    refused(result, /conditional `cd`/);
    assert.deepEqual(result.calls, []);
  }
});

gated("single-quoted command substitution is literal data", () => {
  allowed(run(bash("printf '%s\\n' '$(gh pr merge 7)'"), { noPath: true }), []);
});

gated("quoted heredoc-looking text cannot hide a following merge", () => {
  for (const literal of ["'<<EOF'", '"<<EOF"']) {
    refused(run(bash(`printf '%s\\n' ${literal}\ngh pr merge 7`), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
  }
});

gated("a multiline quoted heredoc-looking literal cannot hide a following merge", () => {
  for (const quote of ["'", '"']) {
    const literal = `printf '%s\\n' ${quote}some literal text\n<<EOF\n${quote}`;
    allowed(run(bash(literal), { noPath: true }), []);
    refused(run(bash(`${literal}\ngh pr merge 7`), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
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
    refused(run(bash(`gh pr merge 7 --squash ${flag}`), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
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
  refused(run(bash(`env -u RAILYARD_CE_SNAPSHOT ${fullMerge}`)), /RAILYARD_CE_SNAPSHOT/);
  refused(run(bash(`env -i ${fullMerge}`)), /RAILYARD_CE_SNAPSHOT/);
  allowed(run(bash(`env -u RAILYARD_CE_MODE ${fullMerge}`), { mode: "unknown" }));
});

gated("nested shell wrappers retain snapshot overrides, unsets and ignored environment", () => {
  for (const prefix of ["env -u RAILYARD_CE_SNAPSHOT", "env -i", "RAILYARD_CE_SNAPSHOT=/missing/ce.json"]) {
    const result = run(bash(`${prefix} bash -lc '${fullMerge}'`));
    refused(result, /RAILYARD_CE_SNAPSHOT|CE snapshot is missing/);
    assert.deepEqual(result.calls, []);
  }
  allowed(run((filename) => bash(`RAILYARD_CE_SNAPSHOT='${filename}' bash -lc '${fullMerge}'`), { noPath: true }));
  refused(run((filename) => bash(`RAILYARD_CE_SNAPSHOT='${filename}' env -u RAILYARD_CE_SNAPSHOT bash -lc '${fullMerge}'`)), /RAILYARD_CE_SNAPSHOT/);
  allowed(run((filename) => bash(`env -u RAILYARD_CE_SNAPSHOT env RAILYARD_CE_SNAPSHOT='${filename}' bash -lc '${fullMerge}'`), { noPath: true }));
});

gated("nested shell wrappers retain cwd for PR resolution and relative query files", () => {
  const result = run((filename) => bash(`env -C '${path.dirname(filename)}' bash -lc 'gh pr merge 7 ${PIN}'`));
  allowed(result, ["pr view", "api graphql"]);
  assert.ok(result.cwds.every((cwd) => path.basename(cwd).startsWith("ce-merge-gate-")));
  const queryResult = run((filename) => bash(`env -C '${path.dirname(filename)}' bash -lc 'gh api graphql -F query=@request.graphql'`), {
    noPath: true,
    prepareFiles: ({ snapshotPath }) => writeFileSync(path.join(path.dirname(snapshotPath), "request.graphql"),
      'mutation { mergePullRequest(input:{pullRequestId:"PR_fixture"}) { clientMutationId } }'),
  });
  refused(queryResult, /mergePullRequest is unsupported/);
  assert.deepEqual(queryResult.calls, []);
});

gated("nested shell wrapper context stays scoped to that child shell", () => {
  allowed(run(bash(`RAILYARD_CE_MODE=unknown bash -lc 'echo ready'; ${fullMerge}`)));
  const result = run(bash(`RAILYARD_CE_MODE=unknown bash -lc '${fullMerge}'`));
  refused(result, /pipeline or interactive/);
  const credentialResult = run(bash(`GH_TOKEN=wrapper-token bash -lc '${fullMerge}'`));
  allowed(credentialResult);
  assert.equal(credentialResult.tokens.at(-1), "wrapper-token");
});

gated("unconditional cwd and shell workdir are preserved; pipeline/subshell cwd does not leak", () => {
  const target = mkdtempSync(path.join(tmpdir(), "ce-merge-cwd-"));
  const outer = mkdtempSync(path.join(tmpdir(), "ce-merge-outer-"));
  try {
    for (const input of [
      bash(`cd ${target} && gh pr merge 7 ${PIN}`),
      bash(`env -C ${target} gh pr merge 7 ${PIN}`),
      bash(`env --chdir=${target} gh pr merge 7 ${PIN}`),
      { ...bash(`gh pr merge 7 ${PIN}`), cwd: target },
      { tool_name: "shell", tool_input: { command: ["bash", "-lc", `gh pr merge 7 ${PIN}`], working_directory: target } },
    ]) {
      const result = run(input);
      allowed(result, ["pr view", "api graphql"]);
      assert.ok(result.cwds.every((cwd) => cwd.endsWith(path.basename(target))));
    }
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
  const setup = prepare({ noPath: true });
  const child = spawn(process.execPath, [script], { env: setup.env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (data) => { stderr += data; });
  const completed = new Promise((resolve) => child.once("close", resolve));
  child.stdin.write(JSON.stringify(bash(fullMerge)));
  const timer = setTimeout(() => child.kill(), 2000);
  try {
    const status = await completed;
    refused(setup.finish({ status, stderr }), /RAILYARD_CE_SNAPSHOT/);
  } finally {
    clearTimeout(timer);
    child.stdin.destroy();
  }
});

gated("a gap inside partial native JSON does not skip verification", async () => {
  const setup = prepare({ noPath: true });
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
    refused(setup.finish({ status: await completed, stderr }), /RAILYARD_CE_SNAPSHOT/);
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

// Refused by the CE gate, with the override named as not applying and no record.
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
    notOverridden(run(bash(`${OVERRIDE} gh pr merge 7 --squash`), { noPath: true, runLogDir: path.join(blocker, "run-log") }), /could not be written/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

gated("an ambient override in the hook's environment does not bypass the gate", () => {
  const setup = prepare({ noPath: true });
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify(bash(adminMerge)), encoding: "utf8", timeout: 6000,
    env: { ...setup.env, RAILYARD_MERGE_OVERRIDE: "user-approved" },
  });
  refused(setup.finish(result), /RAILYARD_CE_SNAPSHOT/);
});

gated("any other override value, or an override not on the merge, is ignored", () => {
  notOverridden(run(bash(`RAILYARD_MERGE_OVERRIDE=yes ${adminMerge}`), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
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
  const result = run(bash(adminMerge), { noPath: true });
  refused(result);
  assert.doesNotMatch(result.err, /RAILYARD_MERGE_OVERRIDE|user-approved|override/);
});

gated("eval and zsh repeat merges are gated, not skipped", () => {
  for (const text of [`eval gh pr merge 7 ${PIN}`, `repeat 2 gh pr merge 7 ${PIN}`, `noglob gh pr merge 7 ${PIN}`]) {
    refused(run(bash(text), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
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

gated("an unresolved cd refuses the CE gate, but a subshell's cd does not leak", () => {
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

gated("the reported override bypasses all fall back to the CE gate", () => {
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
    refused(run(bash(text), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
    refused(run(codexArgv(text), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
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

gated("a merge past the parser's segment or depth cap refuses instead of being skipped", () => {
  refused(run(bash(Array(600).fill("true").join(" && ") + " && gh pr merge 7 --admin"), { noPath: true }), /too long or nested/);
  refused(run(bash(Array(40).fill("true").join("; ") + "; gh pr merge 7 --admin"), { noPath: true }), /RAILYARD_CE_SNAPSHOT/);
  let nested = "gh pr merge 7 --admin";
  for (let level = 0; level < 10; level += 1) nested = `eval ${nested}`;
  refused(run(bash(nested), { noPath: true }), /too long or nested/);
  allowed(run(bash(Array(600).fill("true").join(" && ")), { noPath: true }), []);
});
