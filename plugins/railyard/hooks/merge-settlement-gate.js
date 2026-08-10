#!/usr/bin/env node
// PreToolUse: refuse a pull-request merge issued before review settlement.
//
// CI green is not merge authority. Repos with bot reviewers (GitHub Copilot,
// the Codex connector) get their reviews MINUTES after a PR opens and after
// every push, so every signal a merge decision can read is satisfiable before
// the findings land: checks pass immediately, reviewDecision is null when no
// human review is required, and "require conversation resolution" is vacuously
// true while zero threads exist. This gate closes that latency race the way
// dispatch-gate.js closes the silent-model-inheritance race — as mechanism,
// not prose.
//
// Refuses only two determinable states:
//   (a) the PR has unresolved review threads, or
//   (b) the head commit has zero reviews AND is younger than the settlement
//       window (bot reviewers may not have posted yet).
// Everything else allows — including a head that has sat past the window with
// no reviews, so a repository that genuinely has no reviewers is never
// blocked.
//
// Cross-platform, dependency-free. Fails OPEN on anything it cannot determine
// (gh missing, network error, timeout, unparseable output, unrecognized
// command shape): a broken gate must never block every merge in the repo. It
// fails CLOSED only on a violation it actually observed.

const { execFileSync } = require("child_process");

// Bot reviewers observed posting 3m26s and 4m58s after the head commit on the
// PR that motivated this gate; 10 minutes is ~2x that worst case.
const SETTLEMENT_WINDOW_MS = 10 * 60 * 1000;
// Both bounded well inside the 5s PreToolUse budget. execFileSync has NO
// default timeout, so an unbounded call would hang until the harness killed
// the hook — a path whose verdict the gate would not control.
const VIEW_TIMEOUT_MS = 1500;
const GRAPHQL_TIMEOUT_MS = 3500;

const SETTLEMENT_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      headRefOid
      reviews(last:100){nodes{commit{oid}}}
      reviewThreads(first:100){totalCount nodes{isResolved}}
      commits(last:1){nodes{commit{committedDate}}}
    }
  }
}`;

// Every shell surface both harnesses expose, in one pass. Claude Code's Bash
// tool sends tool_input.command as a STRING; Codex's shell/local_shell send an
// argv ARRAY there, exec_command uses `cmd`, unified_exec uses `input`.
// Unknown shapes contribute nothing and the gate skips.
function commandText(args) {
  const parts = [];
  for (const value of [args.command, args.cmd, args.input]) {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") parts.push(item);
    }
  }
  return parts.join(" ");
}

// `gh pr merge` (gh requires the subcommand immediately after `pr`, so this is
// tight, not loose) and the REST merge endpoint. ponytail: precision over
// recall — a merge phrased some third way is allowed rather than guessed at,
// which is the designed failure direction. Widen only with a real example.
const PR_MERGE_RE = /\bgh\s+pr\s+merge\b/;
const API_MERGE_RE = /\bgh\s+api\b[^\n;|&]*?\brepos\/[^\s/]+\/[^\s/]+\/pulls\/\d+\/merge\b/;

function isPrMerge(text) {
  return PR_MERGE_RE.test(text) || API_MERGE_RE.test(text);
}

// Flags on `gh pr merge` that consume the next token, so a value like `7` in
// `--match-head-commit 7...` is never mistaken for the PR number.
const VALUE_FLAGS = new Set([
  "-R", "--repo", "-b", "--body", "-F", "--body-file", "-t", "--subject",
  "--match-head-commit", "--author-email",
]);

// Pull owner/repo/number out of the command when it carries all three. The
// GraphQL query needs all of owner, name, and number — so a BARE NUMBER
// (`gh pr merge 7`) does NOT qualify: it names the PR but not its repository.
// That is the common case, and it falls through to resolveViaGh below.
function explicitTarget(text) {
  const url = text.match(
    /https?:\/\/[^\s]*?github\.com\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/,
  );
  if (url) return { owner: url[1], name: url[2], number: Number(url[3]) };

  const api = text.match(/\brepos\/([^\s/]+)\/([^\s/]+)\/pulls\/(\d+)\/merge\b/);
  if (api) return { owner: api[1], name: api[2], number: Number(api[3]) };

  const repo = repoFlag(text);
  const number = positionalNumber(text);
  if (repo && number != null) {
    return { owner: repo.owner, name: repo.name, number };
  }
  return null;
}

function repoFlag(text) {
  const m = text.match(/(?:^|\s)(?:-R|--repo)(?:[=\s]+)([^\s/]+)\/([^\s]+)/);
  return m ? { owner: m[1], name: m[2] } : null;
}

// First bare integer after `merge` that is not a value-taking flag's argument.
function positionalNumber(text) {
  const at = text.search(PR_MERGE_RE);
  if (at < 0) return null;
  const tokens = text.slice(at).split(/\s+/).slice(3); // drop gh, pr, merge
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (/^\d+$/.test(token)) {
      // A `--flag=value` token is self-contained and consumes nothing, so a
      // number after it IS the positional. Only space-separated value flags
      // swallow the next token.
      const previous = i > 0 ? tokens[i - 1] : "";
      if (!VALUE_FLAGS.has(previous)) return Number(token);
    }
    if (token === "--") break;
  }
  return null;
}

// The positional PR reference (number, URL, or branch) so `gh` resolves the
// same target the merge would have. Reusing gh's own resolution is a much
// shorter diff than reimplementing branch -> PR lookup from git remotes.
function positionalRef(text) {
  const at = text.search(PR_MERGE_RE);
  if (at < 0) return null;
  const tokens = text.slice(at).split(/\s+/).slice(3);
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--") break;
    if (token.startsWith("-")) continue;
    const previous = i > 0 ? tokens[i - 1] : "";
    if (VALUE_FLAGS.has(previous)) continue;
    if (/[;|&><]/.test(token)) break; // left the merge command
    return token;
  }
  return null;
}

function gh(args, timeout) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    timeout,
    // stdin ignored so a gh auth prompt can never hang the hook.
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function resolveViaGh(text) {
  const args = ["pr", "view"];
  const ref = positionalRef(text);
  if (ref) args.push(ref);
  const repo = repoFlag(text);
  if (repo) args.push("--repo", `${repo.owner}/${repo.name}`);
  args.push("--json", "number,url");
  const view = JSON.parse(gh(args, VIEW_TIMEOUT_MS));
  const url = String(view.url || "").match(
    /github\.com\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/,
  );
  if (!url) throw new Error("gh pr view returned no resolvable PR url");
  return { owner: url[1], name: url[2], number: Number(view.number || url[3]) };
}

function settlement(target) {
  const raw = gh(
    [
      "api", "graphql",
      "-f", `query=${SETTLEMENT_QUERY}`,
      // Bound as variables, never concatenated into the query text, so command
      // text parsed out of an agent-composed string cannot shape the query.
      "-F", `owner=${target.owner}`,
      "-F", `name=${target.name}`,
      "-F", `number=${target.number}`,
    ],
    GRAPHQL_TIMEOUT_MS,
  );
  const pr = JSON.parse(raw)?.data?.repository?.pullRequest;
  if (!pr || typeof pr.headRefOid !== "string") {
    throw new Error("settlement query returned no pull request");
  }
  const threads = pr.reviewThreads?.nodes || [];
  return {
    head: pr.headRefOid,
    threads,
    threadTotal: pr.reviewThreads?.totalCount ?? threads.length,
    reviewedHead: (pr.reviews?.nodes || []).some(
      (review) => review?.commit?.oid === pr.headRefOid,
    ),
    // pushedDate is null from GitHub today, so committedDate is the available
    // proxy for "when did this head get its chance?" — seconds apart for a
    // freshly pushed branch. ponytail: a long-dormant local commit pushed late
    // reads as stale and skips the wait; upgrade to the PR timeline's
    // HeadRefForcePushedEvent/PullRequestCommit timestamps if that ever bites.
    committedDate: pr.commits?.nodes?.[0]?.commit?.committedDate || null,
  };
}

function humanDuration(ms) {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  if (seconds < 120) return `${seconds}s`;
  return `${Math.ceil(seconds / 60)}m`;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (raw += chunk));
process.stdin.on("end", () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // malformed input: allow
  }
  const args = input.tool_input && typeof input.tool_input === "object"
    ? input.tool_input
    : {};

  const text = commandText(args);
  if (!text || !isPrMerge(text)) return; // not a PR merge: silent pass-through

  const block = (msg) => {
    process.stderr.write(msg + "\n");
    process.exitCode = 2;
  };
  // Fail open, but say so: the model should know the gate could not judge.
  const degraded = (why) => {
    process.stderr.write(
      "[railyard] Merge-settlement gate DEGRADED (allowing the merge): " + why +
        ". Review settlement was not verified — confirm reviews have landed" +
        " and threads are resolved before relying on this merge.\n",
    );
  };

  let state;
  let target;
  try {
    target = explicitTarget(text) || resolveViaGh(text);
    state = settlement(target);
  } catch (error) {
    degraded(String((error && error.message) || error).split("\n")[0]);
    return;
  }

  const unresolved = state.threads.filter((thread) => !thread?.isResolved);
  if (unresolved.length) {
    block(
      "[railyard] Merge refused: PR #" + target.number + " has " +
        unresolved.length + " unresolved review thread(s). Reviews that arrive" +
        " after CI turns green are still real findings. Address each one —" +
        " fix it, or reply on the thread with the rationale for declining —" +
        " then resolve the threads (resolveReviewThread via gh api graphql)" +
        " and retry this merge. A tripped guard is waited out or fixed, never" +
        " bypassed.",
    );
    return;
  }

  if (state.threadTotal > state.threads.length) {
    degraded(
      "PR #" + target.number + " has " + state.threadTotal +
        " review threads, more than the gate reads in one page",
    );
    return;
  }

  if (state.reviewedHead) return; // reviewed and nothing unresolved: allow

  const committed = state.committedDate ? Date.parse(state.committedDate) : NaN;
  if (Number.isNaN(committed)) {
    degraded("could not read the head commit date for PR #" + target.number);
    return;
  }

  const age = Date.now() - committed;
  if (age < SETTLEMENT_WINDOW_MS) {
    block(
      "[railyard] Merge refused: the head commit " + state.head.slice(0, 7) +
        " of PR #" + target.number + " has no reviews yet and is only " +
        humanDuration(age) + " old. Bot reviewers (Copilot, the Codex" +
        " connector) post minutes AFTER a push, so green CI is not merge" +
        " authority yet. Wait " + humanDuration(SETTLEMENT_WINDOW_MS - age) +
        " more (settlement window " +
        humanDuration(SETTLEMENT_WINDOW_MS) + " from the head commit), then" +
        " retry — if no review has arrived by then the gate allows the merge," +
        " so waiting is always sufficient. Do not bypass this guard.",
    );
    return;
  }
  // Past the window with no reviews: this repo has no reviewers. Allow, always
  // — never block such a repository indefinitely.
});

// No process.exit(): on Windows, pipe-backed stdout flushes asynchronously and
// exit() can truncate the write. Natural exit is code 0 anyway.
