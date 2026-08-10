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
const NON_MERGE_FLAGS = new Set(["--help", "-h", "--disable-auto"]);
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
  const env = {};
  for (;;) {
    const head = tokens[0];
    if (!head) return null;
    // Keep the assignment, don't just skip it: `GH_REPO=o/r gh pr merge 7`
    // retargets the merge, and discarding it verifies PR 7 in the WRONG repo.
    const assignment = head.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (assignment) {
      env[assignment[1]] = assignment[2];
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
  return basename(tokens[0]) === "gh" ? { tokens: tokens.slice(1), env } : null;
}

// gh accepts `[HOST/]OWNER/REPO`. Keep the HOST: dropping it makes the gate
// query github.com while the merge targets an enterprise host, which usually
// degrades open and lets an unsettled merge through. An unexpanded
// `{owner}`/`{repo}` placeholder means gh will fill it from the current
// repository, so it is not a usable target — return null and let `gh pr view`
// resolve the same way gh itself would.
function parseRepo(value) {
  const parts = String(value || "").split("/").filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[parts.length - 2];
  const name = parts[parts.length - 1];
  if (/[{}]/.test(owner + name)) return null;
  return { host: parts.length > 2 ? parts[parts.length - 3] : null, owner, name };
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

// EVERY merge command in this text. A shell runs them all, so checking only
// the first lets `gh pr merge 5 && gh pr merge 8` merge PR 8 unverified the
// moment PR 5 is settled. `--help` is not a merge.
function mergeCommands(text) {
  const found = [];
  for (const segment of text.split(SEGMENT_SPLIT)) {
    const gh = ghArgs(segment);
    if (!gh) continue;
    const { tokens, env } = gh;
    // `--help` prints usage; `--disable-auto` TURNS OFF auto-merge, which is
    // the mitigation to reach for during a settlement window. Refusing either
    // blocks a command that merges nothing.
    if (tokens.some((t) => NON_MERGE_FLAGS.has(t))) continue;
    const words = positionals(tokens);
    if (words[0] === "pr" && words[1] === "merge") {
      found.push({ kind: "pr", tokens, env, ref: words[2] || null });
    } else if (words[0] === "api") {
      const path = tokens.join(" ").match(REST_MERGE_RE);
      if (path) {
        // Placeholders expand from the current repo, exactly as `gh pr view N`
        // resolves, so hand the number to that path rather than querying a
        // literal `{owner}`.
        found.push({ kind: "api", tokens, env, ref: path[3] });
      } else if (/mergePullRequest/.test(segment)) {
        // A raw GraphQL merge mutation carries a PR node id, not owner/repo/
        // number, so the gate cannot verify it. ponytail: report it loudly
        // instead of passing it in silence — upgrade to resolving the node id
        // if this form ever shows up in real use.
        found.push({ kind: "graphql", tokens, env, ref: null });
      }
    }
  }
  return found;
}

// An explicit -R/--repo wins; otherwise GH_REPO on this same command, which gh
// honors for any command that would otherwise use the local repository.
function repoFromCommand(command) {
  const { tokens, env } = command;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    let value = null;
    if ((token === "-R" || token === "--repo") && tokens[i + 1]) {
      value = tokens[i + 1];
    } else if (token.startsWith("--repo=")) value = token.slice(7);
    else if (token.startsWith("-R=")) value = token.slice(3);
    const repo = value && parseRepo(value);
    if (repo) return repo;
  }
  const fromEnv = env && env.GH_REPO ? parseRepo(env.GH_REPO) : null;
  if (fromEnv) {
    return fromEnv.host || !env.GH_HOST
      ? fromEnv
      : { ...fromEnv, host: env.GH_HOST };
  }
  return null;
}

// owner + repo + number, or null when the command does not carry all three —
// a BARE NUMBER (`gh pr merge 7`) names the PR but not its repository, so it
// falls through to resolveViaGh. That is the common case.
function explicitTarget(command) {
  if (command.kind === "pr") {
    const url = command.ref &&
      command.ref.match(/github\.com\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/);
    if (url) return { owner: url[1], name: url[2], number: Number(url[3]) };
  }
  if (command.kind === "api") {
    // The REST path names the repo directly — unless it is still `{owner}`,
    // which parseRepo rejects so gh resolves it the way gh itself would.
    const path = command.tokens.join(" ").match(REST_MERGE_RE);
    const fromPath = path && parseRepo(`${path[1]}/${path[2]}`);
    if (fromPath) {
      return { ...fromPath, number: Number(path[3]) };
    }
  }
  const repo = repoFromCommand(command);
  if (repo && command.ref && /^\d+$/.test(command.ref)) {
    return { ...repo, number: Number(command.ref) };
  }
  return null;
}

// `host` routes the call at the same GitHub the merge targets. GH_HOST covers
// both `gh pr view` and `gh api graphql` with one mechanism, so an enterprise
// selector cannot leave the gate querying github.com.
function gh(args, timeout, host) {
  return execFileSync("gh", args, {
    encoding: "utf8",
    timeout,
    env: host ? { ...process.env, GH_HOST: host } : process.env,
    // stdin ignored so a gh auth prompt can never hang the hook.
    stdio: ["ignore", "pipe", "ignore"],
  });
}

function resolveViaGh(command) {
  const args = ["pr", "view"];
  if (command.ref) args.push(command.ref);
  const repo = repoFromCommand(command);
  if (repo) args.push("--repo", `${repo.owner}/${repo.name}`);
  args.push("--json", "number,url");
  const view = JSON.parse(gh(args, VIEW_TIMEOUT_MS, repo && repo.host));
  // Any GitHub host, not just github.com — an enterprise URL must still parse.
  const url = String(view.url || "").match(
    /https?:\/\/([^\s/]+)\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/,
  );
  if (!url) throw new Error("gh pr view returned no resolvable PR url");
  return {
    host: url[1] === "github.com" ? null : url[1],
    owner: url[2],
    name: url[3],
    number: Number(view.number || url[4]),
  };
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
    target.host,
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

const ALLOW = { kind: "allow" };
const refuse = (why) => ({ kind: "refuse", why });
const degrade = (why) => ({ kind: "degrade", why });

// One command's verdict. Pure decision over gathered facts, so the handler
// below stays a loop over commands rather than a nest of branches.
function verdictFor(command) {
  if (command.kind === "graphql") {
    return degrade(
      "a raw GraphQL mergePullRequest mutation carries a PR node id the gate" +
        " cannot map to a repo and number. Use `gh pr merge` so review" +
        " settlement can be checked",
    );
  }

  let target;
  let state;
  try {
    target = explicitTarget(command) || resolveViaGh(command);
    state = settlement(target);
  } catch (error) {
    return degrade(String((error && error.message) || error).split("\n")[0]);
  }

  const unresolved = state.threads.filter((thread) => !thread?.isResolved);
  if (unresolved.length) {
    return refuse(
      "PR #" + target.number + " has " + unresolved.length +
        " unresolved review thread(s). Reviews that arrive after CI turns" +
        " green are still real findings. Address each one — fix it, or reply" +
        " on the thread with the rationale for declining — then resolve the" +
        " threads (resolveReviewThread via gh api graphql) and retry this" +
        " merge. A tripped guard is waited out or fixed, never bypassed.",
    );
  }

  if (state.threadTotal > state.threads.length) {
    return degrade(
      "PR #" + target.number + " has " + state.threadTotal +
        " review threads, more than the gate reads in one page",
    );
  }

  if (state.reviewedHead) return ALLOW; // reviewed, nothing unresolved

  const committed = state.committedDate ? Date.parse(state.committedDate) : NaN;
  if (Number.isNaN(committed)) {
    return degrade("could not read the head commit date for PR #" + target.number);
  }

  const age = Date.now() - committed;
  if (age < SETTLEMENT_WINDOW_MS) {
    return refuse(
      "the head commit " + state.head.slice(0, 7) + " of PR #" + target.number +
        " has no reviews yet and is only " + humanDuration(age) +
        " old. Bot reviewers (Copilot, the Codex connector) post minutes" +
        " AFTER a push, so green CI is not merge authority yet. Wait " +
        humanDuration(SETTLEMENT_WINDOW_MS - age) + " more (settlement window " +
        humanDuration(SETTLEMENT_WINDOW_MS) + " from the head commit), then" +
        " retry — if no review has arrived by then the gate allows the merge," +
        " so waiting is always sufficient. Do not bypass this guard.",
    );
  }
  // Past the window with no reviews: this repo has no reviewers. Allow, always
  // — never block such a repository indefinitely.
  return ALLOW;
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
  const commands = mergeCommands(text);
  if (!commands.length) return; // not a PR merge: silent pass-through

  // A shell runs every command in the string, so ONE unsettled merge anywhere
  // condemns the whole call. A determinable violation outranks a degradation.
  const verdicts = commands.map(verdictFor);
  const blocked = verdicts.find((v) => v.kind === "refuse");
  if (blocked) {
    process.stderr.write("[railyard] Merge refused: " + blocked.why + "\n");
    process.exitCode = 2;
    return;
  }
  for (const v of verdicts) {
    if (v.kind !== "degrade") continue;
    // Fail open, but say so: the model must know the gate could not judge.
    process.stderr.write(
      "[railyard] Merge-settlement gate DEGRADED (allowing the merge): " +
        v.why + ". Review settlement was not verified — confirm reviews have" +
        " landed and threads are resolved before relying on this merge.\n",
    );
  }
});

// No process.exit(): on Windows, pipe-backed stdout flushes asynchronously and
// exit() can truncate the write. Natural exit is code 0 anyway.
