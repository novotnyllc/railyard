import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const script = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "merge-settlement-gate.js",
);

// The gh boundary is mocked with a PATH shim rather than a seam in the hook:
// the production path stays completely real (the hook still spawns `gh` and
// parses real JSON) and no production code exists only for testability.
// ponytail: POSIX sh, so these cases are skipped on Windows — validate.yml's
// matrix is ubuntu + macOS. The gate itself is cross-platform.
const SKIP_WIN = process.platform === "win32"
  ? "gh shim is POSIX sh; the gate itself is cross-platform"
  : false;
const gated = (name, fn) => test(name, { skip: SKIP_WIN }, fn);

const SHIM = `#!/bin/sh
echo "$1 $2" >> "$GH_CALL_LOG"
echo "$GH_HOST" >> "$GH_HOST_LOG"
echo "$GH_TOKEN" >> "$GH_TOKEN_LOG"
echo "$XDG_CONFIG_HOME" >> "$GH_XDG_LOG"
pwd >> "$GH_CWD_LOG"
if [ -n "$GH_FIXTURE_SLEEP" ]; then sleep "$GH_FIXTURE_SLEEP"; fi
if [ -n "$GH_FIXTURE_FAIL" ]; then echo "gh: could not authenticate" >&2; exit 1; fi
case "$1 $2" in
  "pr view") printf '%s' "$GH_FIXTURE_VIEW" ;;
  "api graphql") printf '%s' "$GH_FIXTURE_GRAPHQL" ;;
  *) echo "unexpected gh invocation: $*" >&2; exit 3 ;;
esac
`;

const HEAD = "a36a1cf89334911b243c7e9e3d368ce21598394a";
const OLD_SHA = "1111111111111111111111111111111111111111";

const BOT = "copilot-pull-request-reviewer";

// Mirrors the shape the real query returns (verified live against a real PR).
function settlement({
  head = HEAD,
  reviewedHeads = [],
  reviews,
  eyesAgoMs,
  threads = [],
  threadTotal,
  headAgeMs = 30 * 1000,
  committedDate,
} = {}) {
  const reviewNodes = reviews ?? reviewedHeads.map((oid) => ({
    state: "APPROVED",
    author: { login: BOT },
    commit: { oid },
  }));
  const reactionNodes = eyesAgoMs === undefined ? [] : [{
    createdAt: new Date(Date.now() - eyesAgoMs).toISOString(),
    user: { login: BOT },
  }];
  return JSON.stringify({
    data: {
      repository: {
        pullRequest: {
          headRefOid: head,
          reviews: { nodes: reviewNodes },
          reactions: { nodes: reactionNodes },
          reviewThreads: {
            totalCount: threadTotal ?? threads.length,
            nodes: threads.map((isResolved) => ({ isResolved })),
          },
          commits: {
            nodes: [{
              commit: {
                committedDate: committedDate === undefined
                  ? new Date(Date.now() - headAgeMs).toISOString()
                  : committedDate,
              },
            }],
          },
        },
      },
    },
  });
}

const VIEW_OK = JSON.stringify({
  number: 7,
  url: "https://github.com/novotnyllc/railyard/pull/7",
});

// Bash-tool payload (Claude Code): tool_input.command is a string.
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });

function run(input, fixtures = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "merge-gate-"));
  const shim = path.join(dir, "gh");
  writeFileSync(shim, SHIM);
  chmodSync(shim, 0o755);
  const callLog = path.join(dir, "calls.log");
  writeFileSync(callLog, "");
  const hostLog = path.join(dir, "hosts.log");
  writeFileSync(hostLog, "");
  const tokenLog = path.join(dir, "tokens.log");
  writeFileSync(tokenLog, "");
  const xdgLog = path.join(dir, "xdg.log");
  writeFileSync(xdgLog, "");
  const cwdLog = path.join(dir, "cwd.log");
  writeFileSync(cwdLog, "");

  const result = spawnSync(process.execPath, [script], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${dir}${path.delimiter}${process.env.PATH}`,
      GH_CALL_LOG: callLog,
      GH_HOST_LOG: hostLog,
      GH_TOKEN_LOG: tokenLog,
      GH_XDG_LOG: xdgLog,
      GH_CWD_LOG: cwdLog,
      XDG_CONFIG_HOME: "",
      GH_HOST: fixtures.ambientHost ?? "",
      GH_TOKEN: "",
      GH_FIXTURE_VIEW: fixtures.view ?? VIEW_OK,
      GH_FIXTURE_GRAPHQL: fixtures.graphql ?? settlement(),
      GH_FIXTURE_FAIL: fixtures.fail ? "1" : "",
      GH_FIXTURE_SLEEP: fixtures.sleep ?? "",
    },
  });
  const calls = readFileSync(callLog, "utf8").split("\n").filter(Boolean);
  // Trailing "" entries matter (no host override), so do not filter these.
  const hosts = readFileSync(hostLog, "utf8").split("\n").slice(0, calls.length);
  const tokens = readFileSync(tokenLog, "utf8").split("\n").slice(0, calls.length);
  const xdg = readFileSync(xdgLog, "utf8").split("\n").slice(0, calls.length);
  const cwds = readFileSync(cwdLog, "utf8").split("\n").slice(0, calls.length);
  rmSync(dir, { recursive: true, force: true });
  return { code: result.status, err: result.stderr, calls, hosts, tokens, xdg, cwds };
}

// --- refusals (determinable violations only) ------------------------------

gated("unresolved threads are refused, naming the count and the remedy", () => {
  const r = run(bash("gh pr merge 7 --squash"), {
    graphql: settlement({ threads: [true, false, false, false] }),
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /3 unresolved review thread/);
  assert.match(r.err, /resolveReviewThread/);
  assert.match(r.err, /never\s+bypassed/);
});

gated("no review and no signal inside the registration window is refused", () => {
  const r = run(bash("gh pr merge 7 --squash"), {
    graphql: settlement({ reviewedHeads: [], headAgeMs: 60 * 1000 }),
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /no reviewer has registered/);
  assert.match(r.err, /Wait 2m more/);
  assert.match(r.err, /registration window 3m/);
  assert.match(r.err, /a36a1cf/); // names the head it judged
  // The message is the whole remedy: it must never offer an escape hatch.
  // (`gh pr merge --admin` is the real bypass, so name it explicitly.)
  assert.doesNotMatch(r.err, /--no-verify|--admin|skip the gate|disable the (gate|hook)/i);
  // Waiting must be stated as always sufficient, or the model will hunt for
  // another route around the guard.
  assert.match(r.err, /waiting is always sufficient/);
});

gated("a 👀 reaction after the push holds the merge until the review posts", () => {
  // The whole point of the signal-aware wait: a reviewer that registered is a
  // reviewer whose findings are still coming, so this waits past 3 minutes.
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({ headAgeMs: 5 * 60 * 1000, eyesAgoMs: 4 * 60 * 1000 }),
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /👀 reaction from copilot-pull-request-reviewer/);
  assert.match(r.err, /hard cap 20m/);
  assert.match(r.err, /Wait 15m more|at most 15m more/);
  assert.match(r.err, /waiting is always sufficient/);
  assert.doesNotMatch(r.err, /--no-verify|--admin|skip the gate|disable the (gate|hook)/i);
});

gated("a pending (unsubmitted) review is an in-progress signal", () => {
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({
      headAgeMs: 6 * 60 * 1000,
      reviews: [{ state: "PENDING", submittedAt: null, author: { login: "coderabbitai" }, commit: null }],
    }),
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /pending \(unsubmitted\) review from coderabbitai/);
});

gated("a reviewer that reviewed an earlier head is still expected on this one", () => {
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({ reviewedHeads: [OLD_SHA], headAgeMs: 8 * 60 * 1000 }),
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /reviewed an earlier head/);
  assert.match(r.err, /copilot-pull-request-reviewer/);
});

gated("a late review recorded on an older oid is a signal, never settlement", () => {
  // A review of the PREVIOUS head can be submitted after the new head's
  // timestamp. Reading that as settlement would allow merging a head nobody
  // has looked at — the exact stale-review race this gate closes. Only
  // commit-OID equality settles; the late review makes the gate WAIT.
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({
      headAgeMs: 60 * 1000,
      reviews: [{
        state: "COMMENTED",
        author: { login: BOT },
        commit: { oid: OLD_SHA },
      }],
    }),
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /reviewed an earlier head/);
});

gated("unresolved threads outrank every allow path", () => {
  // Reviewed head, stale signal, long past the cap: threads still block.
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({
      reviewedHeads: [HEAD],
      threads: [true, false],
      headAgeMs: 3 * 60 * 60 * 1000,
      eyesAgoMs: 2 * 60 * 60 * 1000,
    }),
  });
  assert.equal(r.code, 2);
  assert.match(r.err, /1 unresolved review thread/);
});

// --- allows ---------------------------------------------------------------

gated("a review on the head allows immediately, with no residual clock", () => {
  // The head is 30s old — far inside every window. A completed review with
  // nothing unresolved is settlement, so there is nothing left to wait for.
  const r = run(bash("gh pr merge 7 --squash"), {
    graphql: settlement({ reviewedHeads: [HEAD], threads: [true, true] }),
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

gated("no signal past the 3-minute registration window is allowed", () => {
  // The flat 10-minute clock burned seven more minutes here for nothing: bots
  // that intend to review register within ~1-3 minutes, so silence is an
  // answer.
  const r = run(bash("gh pr merge 7 --squash"), {
    graphql: settlement({ reviewedHeads: [], threads: [], headAgeMs: 4 * 60 * 1000 }),
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

gated("a stale head with zero reviews is allowed (repo has no reviewers)", () => {
  const r = run(bash("gh pr merge 7 --squash"), {
    graphql: settlement({ reviewedHeads: [], threads: [], headAgeMs: 3 * 60 * 60 * 1000 }),
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

gated("a signal that never produced a review is capped, allowed, and named", () => {
  // A flaky 👀 must not lock merges in the repository forever.
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({ headAgeMs: 25 * 60 * 1000, eyesAgoMs: 24 * 60 * 1000 }),
  });
  assert.equal(r.code, 0);
  assert.match(r.err, /WARNING/);
  assert.match(r.err, /allowing the merge/);
  assert.match(r.err, /👀 reaction from copilot-pull-request-reviewer/);
  assert.match(r.err, /stale/);
});

gated("a 👀 reaction from BEFORE the head push is not a signal for it", () => {
  // It belongs to the previous head; treating it as current would hold every
  // subsequent push for the full cap.
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({ headAgeMs: 4 * 60 * 1000, eyesAgoMs: 9 * 60 * 1000 }),
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

// --- fail open (never block every merge in the repo) ----------------------

gated("gh failure allows with a degradation notice", () => {
  const r = run(bash("gh pr merge 7 --squash"), { fail: true });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
  assert.match(r.err, /allowing the merge/);
});

gated("a hung identity call times out, allows, and reports degradation", () => {
  // The gh pr view call is bounded at ~1500ms; without its own timeout this
  // would hang until the harness killed the hook.
  const r = run(bash("gh pr merge 7 --squash"), { sleep: "3" });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
});

gated("non-JSON gh output allows with a degradation notice", () => {
  const r = run(bash("gh pr merge 7 --squash"), { graphql: "<html>rate limited</html>" });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
});

gated("threads beyond one page are indeterminate, so allowed + degraded", () => {
  const r = run(bash("gh pr merge 7 --squash"), {
    graphql: settlement({ threads: Array(100).fill(true), threadTotal: 250 }),
  });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
  assert.match(r.err, /250 review threads/);
});

gated("an unreadable head commit date allows with a degradation notice", () => {
  const r = run(bash("gh pr merge 7"), {
    graphql: settlement({ reviewedHeads: [], committedDate: null }),
  });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
});

// --- pass-through (must never touch gh) ----------------------------------

gated("a non-merge command passes through silently without calling gh", () => {
  const r = run(bash("git status"));
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

gated("gh pr view is not a merge", () => {
  const r = run(bash("gh pr view 7 --json state"));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, []);
});

gated("git merge is not a PR merge", () => {
  const r = run(bash("git merge origin/main"));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, []);
});

gated("malformed stdin allows silently", () => {
  const r = run("not json");
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

gated("a missing tool_input allows silently", () => {
  const r = run({ tool_name: "Bash" });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});

// --- identity resolution -------------------------------------------------

gated("a bare number calls gh pr view (the common path)", () => {
  const r = run(bash("gh pr merge 7 --squash"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  // A bare number names the PR but not its repo, so identity must be resolved.
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("a full PR URL resolves without calling gh pr view", () => {
  const r = run(bash("gh pr merge https://github.com/novotnyllc/railyard/pull/7 --squash"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]);
});

gated("-R owner/repo plus a number resolves without gh pr view", () => {
  const r = run(bash("gh pr merge -R novotnyllc/railyard 7 --squash"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]);
});

gated("--repo=owner/repo form also resolves without gh pr view", () => {
  const r = run(bash("gh pr merge --repo=novotnyllc/railyard 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]);
});

gated("a bare gh pr merge with no ref resolves via gh pr view", () => {
  const r = run(bash("gh pr merge --squash"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("a value-flag argument is not mistaken for the PR number", () => {
  const r = run(bash("gh pr merge --match-head-commit 7 --squash"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  // No usable positional, so identity resolution is required.
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("gh pr view failing is its own fail-open path", () => {
  const r = run(bash("gh pr merge 7"), { view: "not json" });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
  assert.deepEqual(r.calls, ["pr view"]); // never reached graphql
});

gated("the REST merge endpoint is gated, not skipped", () => {
  const r = run(
    bash("gh api --method PUT repos/novotnyllc/railyard/pulls/7/merge"),
    { graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]); // owner/repo/number came from the path
});

// --- Codex command shapes ------------------------------------------------

gated("Codex shell argv array is extracted and gated", () => {
  const r = run({
    tool_name: "shell",
    tool_input: {
      command: ["bash", "-lc", "gh pr merge 7 --squash"],
      timeout_ms: 120000,
      working_directory: "/tmp",
    },
  }, { graphql: settlement({ threads: [false, false] }) });
  assert.equal(r.code, 2);
  assert.match(r.err, /2 unresolved review thread/);
});

gated("Codex exec_command string cmd is extracted and gated", () => {
  const r = run({
    tool_name: "exec_command",
    tool_input: { cmd: "gh pr merge 7 --squash", yield_time_ms: 250 },
  }, { graphql: settlement({ reviewedHeads: [], headAgeMs: 60 * 1000 }) });
  assert.equal(r.code, 2);
  assert.match(r.err, /no reviewer has registered/);
});

gated("Codex unified_exec input array is extracted and gated", () => {
  const r = run({
    tool_name: "unified_exec",
    tool_input: { input: ["bash", "-lc", "gh pr merge 7"] },
  }, { graphql: settlement({ threads: [false] }) });
  assert.equal(r.code, 2);
  assert.match(r.err, /1 unresolved review thread/);
});

gated("Codex local_shell argv array that is not a merge passes through", () => {
  const r = run({
    tool_name: "local_shell",
    tool_input: { command: ["bash", "-lc", "git status --short"] },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

// --- parser regressions (each of these once defeated the gate) -----------

gated("a global --repo BEFORE the pr subcommand is still gated", () => {
  // gh accepts global flags before the subcommand; requiring `pr` immediately
  // after `gh` let this real, documented form pass through silently.
  const r = run(bash("gh --repo novotnyllc/railyard pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]); // -R supplied owner/repo
});

gated("a global -R before the pr subcommand is still gated", () => {
  const r = run(bash("gh -R novotnyllc/railyard pr merge 7 --squash"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]);
});

gated("gh at an absolute path is still gated", () => {
  const r = run(bash("/opt/homebrew/bin/gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("an env-prefixed invocation is still gated", () => {
  const r = run(bash("GH_HOST=github.com gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a decoy phrase in an earlier segment cannot hijack the identity", () => {
  // The decoy names PR 5; the real merge targets PR 8. Reading the first
  // textual "gh pr merge" resolved 5 — verifying the wrong PR, whose settled
  // state could wrongly ALLOW this merge.
  const r = run(
    bash('git commit -m "docs: gh pr merge 5 workflow notes" && gh pr merge 8'),
    { view: JSON.stringify({ number: 8, url: "https://github.com/novotnyllc/railyard/pull/8" }),
      graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("a --repo on an unrelated earlier gh command is not borrowed", () => {
  // `--repo attacker/decoy` belongs to `gh issue list`, not to the merge.
  const r = run(
    bash("gh issue list --repo attacker/decoy && gh pr merge 8"),
    { view: JSON.stringify({ number: 8, url: "https://github.com/novotnyllc/railyard/pull/8" }),
      graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  // No repo on the merge segment, so identity must be resolved, not assumed.
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("gh pr merge --help is not a merge", () => {
  const r = run(bash("gh pr merge --help"));
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

gated("gh pr merge -h is not a merge", () => {
  const r = run(bash("gh pr merge -h"));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, []);
});

gated("a raw GraphQL merge mutation is reported, never silently passed", () => {
  const r = run(bash(
    "gh api graphql -f query='mutation { mergePullRequest(input: {pullRequestId: \"PR_x\"}) { clientMutationId } }'",
  ));
  assert.equal(r.code, 0); // fail open: no repo/number to verify
  assert.match(r.err, /DEGRADED/);
  assert.match(r.err, /mergePullRequest/);
  assert.deepEqual(r.calls, []);
});

gated("a merge inside a bash -lc string wrapper is still gated", () => {
  const r = run(bash('bash -lc "gh pr merge 7 --squash"'), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("GH_REPO on the merge command retargets the check", () => {
  // Discarding the assignment verified PR 7 in the CURRENT repo, so a settled
  // local PR #7 could vouch for an unsettled merge in the target repo.
  const r = run(bash("GH_REPO=other/target gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]); // GH_REPO supplied owner/repo
});

gated("env-prefixed GH_REPO through an env wrapper also retargets", () => {
  const r = run(bash("env GH_REPO=other/target gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]);
});

gated("EVERY merge in a chained command is checked, not just the first", () => {
  // A shell runs both. Checking only the first let `gh pr merge 5 && gh pr
  // merge 8` merge PR 8 unverified as soon as PR 5 was settled.
  const r = run(bash("gh pr merge 5 && gh pr merge 8"), {
    graphql: settlement({ reviewedHeads: [HEAD], threads: [true] }),
  });
  assert.equal(r.code, 0);
  assert.equal(r.calls.filter((c) => c === "api graphql").length, 2);
});

gated("an unsettled second merge condemns the whole command", () => {
  const r = run(bash("gh pr merge 5 && gh pr merge 8"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("gh api {owner}/{repo} placeholders resolve, never query literally", () => {
  // The placeholders expand from the current repo; querying `{owner}` made the
  // settlement call fail, degrade open, and let the real merge through.
  const r = run(bash("gh api --method PUT repos/{owner}/{repo}/pulls/7/merge"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("a host-qualified -R HOST/OWNER/REPO selector is honored", () => {
  const r = run(bash("gh -R github.example.com/owner/repo pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]); // selector parsed, not dropped
});

gated("a host-qualified selector routes the gh calls at that host", () => {
  // Parsing the selector but discarding its host left the gate querying
  // github.com while the merge targeted the enterprise host — usually
  // degrading open on an unsettled merge.
  const r = run(bash("gh -R github.example.com/owner/repo pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.equal(r.hosts.at(-1), "github.example.com");
});

gated("a plain OWNER/REPO selector sets no host override", () => {
  const r = run(bash("gh -R owner/repo pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.equal(r.hosts.at(-1), "");
});

gated("--disable-auto turns auto-merge OFF and is not a merge", () => {
  // This is the mitigation to reach for during a settlement window; refusing
  // it blocks the very command that stands the merge down.
  const r = run(bash("gh pr merge 7 --disable-auto"));
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

gated("--auto is still a merge (it merges once checks pass)", () => {
  const r = run(bash("gh pr merge 7 --auto --squash"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("the documented AGENTS.md verify command lists every CI suite", () => {
  // AGENTS.md states its list is exactly what validate.yml runs; drift means
  // the documented local path silently skips a suite.
  const root = new URL("../../../", import.meta.url);
  const agents = readFileSync(new URL("AGENTS.md", root), "utf8");
  const workflow = readFileSync(new URL(".github/workflows/validate.yml", root), "utf8");
  const suites = (text) =>
    [...text.matchAll(/plugins\/railyard\/[^\s\\]+\.test\.mjs/g)].map((m) => m[0]).sort();
  assert.deepEqual(suites(agents), [...new Set(suites(workflow))].sort());
});

gated("--help as a flag VALUE does not skip the gate", () => {
  // `gh pr merge 7 --body --help` uses --help as the commit body. A token-wide
  // scan treated it as the help flag and skipped the gate entirely.
  const r = run(bash("gh pr merge 7 --body --help"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("gh api --hostname routes the settlement query at that host", () => {
  const r = run(
    bash("gh api --hostname github.example.com --method PUT repos/owner/repo/pulls/7/merge"),
    { graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  assert.equal(r.hosts.at(-1), "github.example.com");
});

gated("a batch of merges cannot outlive the whole-process budget", () => {
  // Per-call limits alone let N sequential merges exceed the harness's 5s cap,
  // which kills the hook before it returns ANY verdict. The shared budget must
  // end the run itself, fail-open, well inside the cap.
  const started = Date.now();
  const r = run(
    bash("gh pr merge 5 && gh pr merge 6 && gh pr merge 7 && gh pr merge 8"),
    { sleep: "2" },
  );
  const elapsed = Date.now() - started;
  assert.equal(r.code, 0); // degraded, never a hang
  assert.match(r.err, /DEGRADED/);
  assert.ok(elapsed < 5000, `took ${elapsed}ms, must stay under the 5s cap`);
});

gated("inline GH_TOKEN is forwarded to the settlement calls", () => {
  // Without it the settlement query is unauthenticated and degrades open,
  // while the shell's merge succeeds using the very token we ignored.
  const r = run(bash("GH_TOKEN=ghp_secret gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.equal(r.tokens.at(-1), "ghp_secret");
});

gated("an ambient enterprise GH_HOST cannot capture a github.com URL", () => {
  // The URL names the host; leaving it unset let the ambient enterprise host
  // decide, so the gate verified an unrelated PR on the wrong GitHub.
  const r = run(
    bash("gh pr merge https://github.com/owner/repo/pull/7"),
    { ambientHost: "github.example.com", graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  assert.equal(r.hosts.at(-1), "github.com");
});

gated("a merge inside shell grouping is still gated", () => {
  const r = run(bash("(gh pr merge 7)"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a merge behind an if-condition is still gated", () => {
  const r = run(bash("if gh pr merge 7; then echo merged; fi"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("-A consumes its value and does not become the PR ref", () => {
  const r = run(bash("gh pr merge -A dev@example.com 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("a merge inside a case block is still gated", () => {
  const r = run(bash("case yes in yes) gh pr merge 7;; esac"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a merge inside command substitution is still gated", () => {
  const r = run(bash("echo $(gh pr merge 7)"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("an attached -Rowner/repo selector is parsed, not treated as a flag", () => {
  // Recorded as a boolean flag, the selector was lost and the gate resolved
  // PR 7 in the CURRENT repo — a settled local PR authorizing a foreign merge.
  const r = run(bash("gh -Rother/target pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["api graphql"]); // resolved without gh pr view
});

gated("--hostname survives when the repo itself is a placeholder", () => {
  // Placeholders mean no repo object; the host must still reach the query.
  const r = run(
    bash("gh api --hostname github.example.com -X PUT repos/{owner}/{repo}/pulls/7/merge"),
    {
      // gh pr view, run at the enterprise host, returns an enterprise URL.
      view: JSON.stringify({
        number: 7,
        url: "https://github.example.com/owner/repo/pull/7",
      }),
      graphql: settlement({ threads: [false] }),
    },
  );
  assert.equal(r.code, 2);
  // Both calls must reach the enterprise host: the identity lookup because the
  // placeholders expand there, the settlement query because that is where the
  // PR lives.
  assert.deepEqual(r.hosts, ["github.example.com", "github.example.com"]);
});

gated("--jq taking --help as its value does not skip the gate", () => {
  const r = run(
    bash("gh api -X PUT repos/o/r/pulls/7/merge --jq --help"),
    { graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
});

gated("a quoted multiword --body value cannot smuggle --help", () => {
  // A whitespace split shredded the quoted value, so `--help` looked like a
  // real option and the gate skipped a command gh would actually merge.
  const r = run(bash('gh pr merge 7 --body "normal text --help"'), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a quoted separator cannot manufacture a decoy segment", () => {
  // Previously an accepted ceiling; quote-aware tokenizing closes it.
  const r = run(
    bash('printf "x && gh pr merge 5" && gh pr merge 8'),
    { view: JSON.stringify({ number: 8, url: "https://github.com/novotnyllc/railyard/pull/8" }),
      graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  // Only the REAL merge is checked — the quoted decoy never becomes a command.
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("gh api does not take its host from GH_REPO", () => {
  // GH_REPO fills {owner}/{repo} for gh api; it does not select the host.
  // Promoting its host queried the enterprise host while the PUT went to
  // github.com.
  const r = run(
    bash("GH_REPO=github.example.com/foo/bar gh api -X PUT repos/owner/repo/pulls/7/merge"),
    { graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  assert.equal(r.hosts.at(-1), "");
});

gated("inline XDG_CONFIG_HOME reaches the settlement calls", () => {
  const r = run(bash("XDG_CONFIG_HOME=/tmp/profile gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.equal(r.xdg.at(-1), "/tmp/profile");
});

gated("an unquoted newline separates commands", () => {
  // A multiline script is ordinary; treating the newline as whitespace left
  // the merge inside an `echo` segment and it ran with no gate at all.
  const r = run(bash("echo preparing\ngh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a cd before the merge moves the identity lookup too", () => {
  // `cd ../other && gh pr merge 7` resolves PR 7 in ../other; checking PR 7
  // here instead lets a settled local PR authorize an unsettled foreign one.
  const target = mkdtempSync(path.join(tmpdir(), "merge-gate-cwd-"));
  const r = run(bash(`cd ${target} && gh pr merge 7`), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  // macOS reports /private/var for /var, so compare the resolved leaf.
  assert.ok(
    r.cwds.every((c) => c.endsWith(path.basename(target))),
    `gh ran in ${JSON.stringify(r.cwds)}, expected ${target}`,
  );
  rmSync(target, { recursive: true, force: true });
});

gated("a header value cannot decoy the gh api endpoint", () => {
  const r = run(
    bash("gh api -H 'X-Test: repos/decoy/settled/pulls/5/merge' -X PUT repos/real/unsettled/pulls/8/merge"),
    { graphql: settlement({ threads: [false] }) },
  );
  assert.equal(r.code, 2);
  assert.match(r.err, /PR #8/); // the real endpoint, not the header decoy
});

gated("a backslash line continuation does not become the PR ref", () => {
  const r = run(bash("gh pr merge \\\n7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.deepEqual(r.calls, ["pr view", "api graphql"]);
});

gated("the shell tool's working_directory is where the lookup runs", () => {
  // Codex shell calls carry a per-call directory; the merge runs there.
  const target = mkdtempSync(path.join(tmpdir(), "merge-gate-wd-"));
  const r = run({
    tool_name: "shell",
    tool_input: { command: ["bash", "-lc", "gh pr merge 7"], working_directory: target },
  }, { graphql: settlement({ threads: [false] }) });
  assert.equal(r.code, 2);
  assert.ok(
    r.cwds.every((c) => c.endsWith(path.basename(target))),
    `gh ran in ${JSON.stringify(r.cwds)}, expected ${target}`,
  );
  rmSync(target, { recursive: true, force: true });
});

gated("a subshell cd does not leak into the merge that follows it", () => {
  // `(cd ../other && run-tests); gh pr merge 7` merges in the ORIGINAL repo.
  const target = mkdtempSync(path.join(tmpdir(), "merge-gate-sub-"));
  const base = mkdtempSync(path.join(tmpdir(), "merge-gate-base-"));
  const r = run({
    tool_name: "Bash",
    tool_input: {
      command: `(cd ${target} && echo testing); gh pr merge 7`,
      working_directory: base,
    },
  }, { graphql: settlement({ threads: [false] }) });
  assert.equal(r.code, 2);
  assert.ok(
    r.cwds.every((c) => c.endsWith(path.basename(base))),
    `gh ran in ${JSON.stringify(r.cwds)}, expected ${base}`,
  );
  rmSync(target, { recursive: true, force: true });
  rmSync(base, { recursive: true, force: true });
});

gated("a heredoc body is data, not a command to gate", () => {
  // Writing a release script that mentions gh pr merge must not be refused.
  const r = run(bash("cat >release.sh <<'EOF'\ngh pr merge 7\nEOF"));
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

gated("a conditional cd makes the directory unknown, so the merge degrades", () => {
  // `false && cd ../other; gh pr merge 7` never runs the cd, so applying it
  // would verify a repository the merge will not touch.
  const r = run(bash("false && cd /tmp; gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
  assert.match(r.err, /conditional `cd`/);
  assert.deepEqual(r.calls, []);
});

gated("an unconditional cd before && still applies", () => {
  // The legitimate shape must keep working: cd runs, then the merge.
  const target = mkdtempSync(path.join(tmpdir(), "merge-gate-uncond-"));
  const r = run(bash(`cd ${target} && gh pr merge 7`), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.ok(r.cwds.every((c) => c.endsWith(path.basename(target))));
  rmSync(target, { recursive: true, force: true });
});

gated("env -u consumes its variable name before gh is located", () => {
  const r = run(bash("env -u GH_HOST gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("env -C runs the lookup in the directory the merge will use", () => {
  const target = mkdtempSync(path.join(tmpdir(), "merge-gate-envc-"));
  const r = run(bash(`env -C ${target} gh pr merge 7`), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.ok(
    r.cwds.every((c) => c.endsWith(path.basename(target))),
    `gh ran in ${JSON.stringify(r.cwds)}, expected ${target}`,
  );
  rmSync(target, { recursive: true, force: true });
});

gated("a GET on the merge endpoint is a status check, not a merge", () => {
  // gh api defaults to GET; refusing this would block a read-only check.
  const r = run(bash("gh api repos/o/r/pulls/7/merge"));
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

gated("an explicit -X GET on the merge endpoint is also not a merge", () => {
  const r = run(bash("gh api -X GET repos/o/r/pulls/7/merge"));
  assert.equal(r.code, 0);
  assert.deepEqual(r.calls, []);
});

gated("env -u removes the variable from the gate's own calls", () => {
  // With ambient GH_HOST set, the merge defaults to github.com after the
  // unset; the gate must not keep querying the enterprise host.
  const r = run(bash("env -u GH_HOST gh pr merge 7"), {
    ambientHost: "github.example.com",
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  // The identity lookup must run with GH_HOST removed, exactly as the merge
  // would. (The settlement call then pins whatever host the PR resolved to.)
  assert.equal(r.hosts[0], "");
  assert.ok(
    r.hosts.every((h) => h !== "github.example.com"),
    `enterprise host leaked into ${JSON.stringify(r.hosts)}`,
  );
});

gated("env --chdir=DIR (attached form) is honored", () => {
  const target = mkdtempSync(path.join(tmpdir(), "merge-gate-attach-"));
  const r = run(bash(`env --chdir=${target} gh pr merge 7`), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
  assert.ok(
    r.cwds.every((c) => c.endsWith(path.basename(target))),
    `gh ran in ${JSON.stringify(r.cwds)}, expected ${target}`,
  );
  rmSync(target, { recursive: true, force: true });
});

gated("a cd behind control words makes the directory indeterminate", () => {
  // `if true; then cd ../other; fi` — the branch is not evaluable here, so
  // degrade rather than verify a directory the merge may not use.
  const r = run(bash("if true; then cd /tmp; fi; gh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
  assert.deepEqual(r.calls, []);
});

gated("a here-string does not swallow the following commands", () => {
  // `<<<` is inline data, not a heredoc; matching it as one made every later
  // line vanish and silently disabled the gate.
  const r = run(bash("cat <<<EOF\ngh pr merge 7"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a brace command group is still gated", () => {
  const r = run(bash("{ gh pr merge 7; }"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("an escaped quote inside a value does not end the quote", () => {
  const r = run(bash('gh pr merge 7 --body "text \\" --help"'), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("command substitution inside double quotes is still gated", () => {
  const r = run(bash('echo "$(gh pr merge 7)"'), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("clustered short flags are expanded (-iXPUT sends a PUT)", () => {
  const r = run(bash("gh api -iXPUT repos/o/r/pulls/7/merge"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("env -S runs its split string as the command", () => {
  const r = run(bash("env -S 'gh pr merge 7'"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("env -i does not let the gate inherit the ambient environment", () => {
  const r = run(bash("env -i PATH=$PATH gh pr merge 7"), {
    ambientHost: "github.example.com",
    graphql: settlement({ threads: [false] }),
  });
  // The command IS detected (a silent skip would leave stderr empty). The gate
  // then runs gh with the ambient environment stripped, exactly as the merge
  // would — which here means the shim loses its own logging vars and fails, so
  // the gate degrades open rather than answering from a richer environment
  // than the merge gets.
  assert.equal(r.code, 0);
  assert.match(r.err, /DEGRADED/);
});

gated("argv boundaries survive: a spaced --body value stays one argument", () => {
  // Joining argv on spaces turned the body text into tokens and made --help a
  // real option again, skipping the gate on a Codex-native payload shape.
  const r = run({
    tool_name: "shell",
    tool_input: { command: ["gh", "pr", "merge", "7", "--body", "normal text --help"] },
  }, { graphql: settlement({ threads: [false] }) });
  assert.equal(r.code, 2);
});

gated("stacked wrappers are peeled to find the merge", () => {
  const r = run(bash("env bash -lc 'gh pr merge 7'"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a backtick substitution is still gated", () => {
  const r = run(bash("echo `gh pr merge 7`"), {
    graphql: settlement({ threads: [false] }),
  });
  assert.equal(r.code, 2);
});

gated("a cd inside a pipeline does not move the later merge", () => {
  // `cd /tmp | cat` runs in a subshell; the merge stays in the original dir.
  const base = mkdtempSync(path.join(tmpdir(), "merge-gate-pipe-"));
  const r = run({
    tool_name: "Bash",
    tool_input: { command: "cd /tmp | cat; gh pr merge 7", working_directory: base },
  }, { graphql: settlement({ threads: [false] }) });
  assert.equal(r.code, 2);
  assert.ok(
    r.cwds.every((c) => c.endsWith(path.basename(base))),
    `gh ran in ${JSON.stringify(r.cwds)}, expected ${base}`,
  );
  rmSync(base, { recursive: true, force: true });
});

gated("a literal ; in argv is data, not a command separator", () => {
  // `printf %s ";" gh pr merge 7` runs printf — no merge. Letting the argument
  // split the command would refuse a harmless call.
  const r = run({
    tool_name: "shell",
    tool_input: { command: ["printf", "%s", ";", "gh", "pr", "merge", "7"] },
  });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
  assert.deepEqual(r.calls, []);
});

gated("the two gh timeouts leave real margin under the 5s hook cap", () => {
  // Sequential worst case must clear the harness cap, or the harness kills the
  // hook before its own fail-open path runs.
  const source = readFileSync(
    new URL("./merge-settlement-gate.js", import.meta.url),
    "utf8",
  );
  const view = Number(source.match(/VIEW_TIMEOUT_MS = (\d+)/)[1]);
  const graphql = Number(source.match(/GRAPHQL_TIMEOUT_MS = (\d+)/)[1]);
  assert.ok(view + graphql <= 4000, `sum ${view + graphql}ms leaves no margin`);
});

gated("an argv array allowed after settlement stays silent", () => {
  const r = run({
    tool_name: "shell",
    tool_input: { command: ["bash", "-lc", "gh pr merge 7 --squash"] },
  }, { graphql: settlement({ reviewedHeads: [HEAD], threads: [true] }) });
  assert.equal(r.code, 0);
  assert.equal(r.err, "");
});
