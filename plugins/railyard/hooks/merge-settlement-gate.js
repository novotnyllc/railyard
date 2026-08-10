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
// The two calls are sequential in the worst case, so their SUM plus Node
// startup must clear the harness's 5s PreToolUse cap with room to spare —
// otherwise the harness kills the hook before its own fail-open path runs, and
// the gate stops controlling its own verdict. 1200 + 2500 + ~100ms startup
// leaves ~1.2s of margin. (Measured real-world: ~0.8s for the whole path.)
// execFileSync has NO default timeout, so an unbounded call would hang.
const VIEW_TIMEOUT_MS = 1200;
const GRAPHQL_TIMEOUT_MS = 2500;

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

// Parsing is SEGMENT-SCOPED, not phrase-scoped. A phrase search over the whole
// command string gets two things wrong that both defeat the gate: `gh --repo
// o/r pr merge 7` puts a global flag between `gh` and `pr` (a real, documented
// invocation), and a decoy phrase in an unrelated segment —
// `git commit -m "docs: gh pr merge 5" && gh pr merge 8` — hijacks the
// identity onto the wrong PR, whose settled state can wrongly ALLOW the real
// merge. So: split into commands, find the one that really is a merge, and
// read its identity from that command's tokens only.
const SEGMENT_SPLIT = /\|\||&&|[;\n|&]/;
// Wrappers an agent puts in front of the real command — notably Codex's argv
// form ["bash","-lc","gh pr merge 7"], which joins to a wrapper-prefixed string.
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "dash", "env"]);
// Flags that consume the following token, so `--match-head-commit 7` never
// yields `7` as the PR number. One union set covers gh's global flags and
// `gh pr merge`'s own; over-listing is harmless, under-listing is a bug.
const VALUE_FLAGS = new Set([
  "-R", "--repo", "-b", "--body", "-F", "--body-file", "-t", "--subject",
  "--match-head-commit", "--author-email",
]);
const REST_MERGE_RE = /repos\/([^\s/]+)\/([^\s/]+)\/pulls\/(\d+)\/merge/;

const unquote = (token) => token.replace(/^['"]+/, "").replace(/['"]+$/, "");

function basename(token) {
  const cut = token.lastIndexOf("/");
  return cut < 0 ? token : token.slice(cut + 1);
}

// Reduce one shell command to gh's own arguments, or null when it is not a gh
// invocation. Strips leading env assignments and any shell wrapper, so
// `FOO=1 bash -lc "/usr/local/bin/gh pr merge 7"` still resolves.
function ghArgs(segment) {
  let tokens = segment.trim().split(/\s+/).map(unquote).filter(Boolean);
  for (;;) {
    const head = tokens[0];
    if (!head) return null;
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(head)) {
      tokens = tokens.slice(1);
      continue;
    }
    if (SHELL_WRAPPERS.has(basename(head))) {
      tokens = tokens.slice(1);
      while (tokens[0] && tokens[0].startsWith("-")) tokens = tokens.slice(1);
      continue;
    }
    break;
  }
  return basename(tokens[0]) === "gh" ? tokens.slice(1) : null;
}

// Positional words in order, with flags and their consumed values removed —
// so the subcommand path reads the same whether or not global flags precede it.
function positionals(tokens) {
  const out = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--") {
      for (const rest of tokens.slice(i + 1)) out.push(rest);
      break;
    }
    if (token.startsWith("-")) {
      if (VALUE_FLAGS.has(token)) i += 1; // `--flag=value` consumes nothing
      continue;
    }
    out.push(token);
  }
  return out;
}

// The one merge command in this text, or null. `--help` is not a merge.
function mergeCommand(text) {
  for (const segment of text.split(SEGMENT_SPLIT)) {
    const tokens = ghArgs(segment);
    if (!tokens) continue;
    if (tokens.some((t) => t === "--help" || t === "-h")) continue;
    const words = positionals(tokens);
    if (words[0] === "pr" && words[1] === "merge") {
      return { kind: "pr", tokens, ref: words[2] || null };
    }
    if (words[0] === "api") {
      if (tokens.some((t) => REST_MERGE_RE.test(t))) {
        return { kind: "api", tokens, ref: null };
      }
      // A raw GraphQL merge mutation carries a PR node id, not owner/repo/
      // number, so the gate cannot verify it. ponytail: report it loudly
      // instead of passing it in silence — upgrade to resolving the node id
      // if this form ever shows up in real use.
      if (/mergePullRequest/.test(segment)) {
        return { kind: "graphql", tokens, ref: null };
      }
    }
  }
  return null;
}

function repoFromTokens(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    let value = null;
    if ((token === "-R" || token === "--repo") && tokens[i + 1]) {
      value = tokens[i + 1];
    } else if (token.startsWith("--repo=")) value = token.slice(7);
    else if (token.startsWith("-R=")) value = token.slice(3);
    const match = value && value.match(/^([^\s/]+)\/([^\s/]+)$/);
    if (match) return { owner: match[1], name: match[2] };
  }
  return null;
}

// owner + repo + number, or null when the command does not carry all three —
// a BARE NUMBER (`gh pr merge 7`) names the PR but not its repository, so it
// falls through to resolveViaGh. That is the common case.
function explicitTarget(command) {
  if (command.kind === "api") {
    const path = command.tokens.join(" ").match(REST_MERGE_RE);
    return path
      ? { owner: path[1], name: path[2], number: Number(path[3]) }
      : null;
  }
  const url = command.ref &&
    command.ref.match(/github\.com\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/);
  if (url) return { owner: url[1], name: url[2], number: Number(url[3]) };

  const repo = repoFromTokens(command.tokens);
  if (repo && command.ref && /^\d+$/.test(command.ref)) {
    return { owner: repo.owner, name: repo.name, number: Number(command.ref) };
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

function resolveViaGh(command) {
  const args = ["pr", "view"];
  if (command.ref) args.push(command.ref);
  const repo = repoFromTokens(command.tokens);
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
  if (!text) return; // nothing to read: silent pass-through
  const command = mergeCommand(text);
  if (!command) return; // not a PR merge: silent pass-through

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

  if (command.kind === "graphql") {
    degraded(
      "this is a raw GraphQL mergePullRequest mutation, which carries a PR" +
        " node id the gate cannot map to a repo and number. Use `gh pr merge`" +
        " so review settlement can be checked",
    );
    return;
  }

  let state;
  let target;
  try {
    target = explicitTarget(command) || resolveViaGh(command);
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
