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
// Refuses only determinable states:
//   (a) the PR has unresolved review threads, or
//   (b) the head commit has no review yet AND is inside a bounded wait.
// The wait is SIGNAL-AWARE rather than a flat clock. Bots that intend to
// review REGISTER within ~1-3 minutes of a push — a 👀 reaction, a pending
// review, or a review they already posted on an earlier head. So:
//   - a review already on this head, with nothing unresolved and no OTHER
//     reviewer still registered, allows immediately (no residual clock);
//   - no signal at all past the 3-minute registration window means nobody is
//     coming, so it allows;
//   - a signal that has not turned into a review yet holds the merge until it
//     does, capped at 20 minutes from the head push so a flaky signal cannot
//     lock the repository forever.
// Everything else allows — a repository that genuinely has no reviewers is
// never blocked.
//
// Cross-platform, dependency-free. Fails OPEN on anything it cannot determine
// (gh missing, network error, timeout, unparseable output, unrecognized
// command shape): a broken gate must never block every merge in the repo. It
// fails CLOSED only on a violation it actually observed.

const { execFileSync } = require("child_process");
const path = require("path");

// Bot reviewers observed posting 3m26s and 4m58s after the head commit on the
// PR that motivated this gate — but they REGISTERED (👀 on the PR, a review
// left pending) inside the first minute. Registration is the cheap signal, so
// the no-signal wait is 3 minutes, not the ~2x-worst-case 10 the flat clock
// used to burn on every merge in every repository with no reviewers at all.
const REGISTRATION_WINDOW_MS = 3 * 60 * 1000;
// A registered reviewer that never posts must not hold merges forever: past
// this the gate allows with a warning naming the stale signal. ~4x the
// observed worst-case post time.
const SIGNAL_CAP_MS = 20 * 60 * 1000;
// The two calls are sequential in the worst case, so their SUM plus Node
// startup must clear the harness's 5s PreToolUse cap with room to spare —
// otherwise the harness kills the hook before its own fail-open path runs, and
// the gate stops controlling its own verdict. 1200 + 2500 + ~100ms startup
// leaves ~1.2s of margin. (Measured real-world: ~0.8s for the whole path.)
// execFileSync has NO default timeout, so an unbounded call would hang.
const VIEW_TIMEOUT_MS = 1200;
const GRAPHQL_TIMEOUT_MS = 2500;
// Per-call limits alone are not enough: one command can carry several merges,
// and checking them sequentially at the per-call worst case would outlive the
// harness cap (2 merges x 3.7s = 7.4s), which kills the hook before it
// returns any verdict. This is the whole-process budget every gh call draws
// down; running out degrades open with a notice, like any other unknown.
const TOTAL_BUDGET_MS = 4000;
const DEADLINE = Date.now() + TOTAL_BUDGET_MS;

const SETTLEMENT_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      headRefOid
      reviews(last:100){nodes{state author{login} commit{oid}}}
      reviewThreads(first:100){totalCount nodes{isResolved}}
      reactions(content:EYES,last:20){nodes{createdAt user{login}}}
      commits(last:1){nodes{commit{committedDate}}}
    }
  }
}`;

// Every shell surface both harnesses expose, in one pass. Claude Code's Bash
// tool sends tool_input.command as a STRING; Codex's shell/local_shell send an
// argv ARRAY there, exec_command uses `cmd`, unified_exec uses `input`.
// Unknown shapes contribute nothing and the gate skips.
// An argv ARRAY already carries its word boundaries, so joining on spaces
// destroys them: ["--body","normal text --help"] would turn the body's text
// into separate tokens and `--help` back into a real option. Re-quote any
// element containing whitespace OR a shell metacharacter, so that a literal
// argument like ";" stays data instead of becoming a command separator and
// refusing a harmless command.
const requote = (item) => (/[\s'"`;|&()<>{}$]/.test(item)
  ? "'" + item.replace(/'/g, "'\\''") + "'"
  : item);

function commandText(args) {
  const parts = [];
  for (const value of [args.command, args.cmd, args.input]) {
    if (typeof value === "string") parts.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") parts.push(requote(item));
    }
  }
  return parts.join(" ");
}

// Parsing is SEGMENT-SCOPED and QUOTE-AWARE, not a phrase search. Two things
// break a naive scan, and both let a real merge through unchecked:
//   - `gh --repo o/r pr merge 7` puts a global flag between `gh` and `pr`, and
//     a decoy phrase in an unrelated segment can hijack identity onto another
//     PR whose settled state then wrongly ALLOWS the real merge.
//   - a whitespace split shreds quoted values, so `--body "text --help"` looks
//     like a real `--help` option and skips the gate entirely.
// So: tokenize once, honoring quotes, split into commands at UNQUOTED shell
// separators, and read each command's identity from its own tokens.
const SHELL_WRAPPERS = new Set(["bash", "sh", "zsh", "dash", "env"]);
// Control words and grouping punctuation a merge can legitimately sit behind:
// `(gh pr merge 7)`, `if gh pr merge 7; then ...`. Missing these means the
// segment looks unrelated and the merge runs with no gate and no notice.
const CONTROL_WORDS = new Set([
  "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "for",
  "case", "esac", "in", "select", "function", "time", "command", "exec",
  "nohup", "builtin",
  // Bash runs `{ gh pr merge 7; }` as a command group. These are standalone
  // TOKENS, never split at the character level — `repos/{owner}/{repo}/…`
  // must stay one token.
  "{", "}",
]);
// Authentication the merge command carries inline. Without forwarding it the
// settlement query is unauthenticated, degrades open, and the shell's merge
// then succeeds unchecked with the very token we ignored.
const AUTH_ENV = [
  "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN",
  // gh resolves its config dir as GH_CONFIG_DIR, then $XDG_CONFIG_HOME/gh,
  // then $HOME/.config/gh — so credentials can live behind any of these.
  "GH_CONFIG_DIR", "XDG_CONFIG_HOME", "HOME",
];
// Flags that consume the following token, so `--match-head-commit 7` never
// yields `7` as the PR number. One union set covers gh's global flags and
// `gh pr merge`'s own; over-listing is harmless, under-listing is a bug.
const VALUE_FLAGS = new Set([
  "-R", "--repo", "-b", "--body", "-F", "--body-file", "-t", "--subject",
  "--match-head-commit", "--author-email", "-A",
  // gh api's own value-taking flags, so `--hostname HOST` is read as a host,
  // `--method PUT` does not leak `PUT` into the positional words, and a value
  // that happens to be `--help` (e.g. `--jq --help`) is never read as the help
  // option and used to skip the gate.
  "--hostname", "--method", "-X", "-f", "-H", "--header", "--input",
  "-q", "--jq", "-p", "--preview", "--template", "--cache", "--raw-field",
  "--field",
]);
// Single-dash flags gh also accepts with the value attached (`-Rowner/repo`).
// Missing these records the whole token as a boolean flag, so the selector is
// lost and the gate silently resolves the PR in the wrong repository.
const SHORT_VALUE_FLAGS = new Set(
  [...VALUE_FLAGS].filter((f) => /^-[A-Za-z]$/.test(f)),
);
const NON_MERGE_FLAGS = new Set(["--help", "-h", "--disable-auto"]);
const REST_MERGE_RE = /repos\/([^\s/]+)\/([^\s/]+)\/pulls\/(\d+)\/merge/;

// Also sheds grouping punctuation, so `(gh` and `7)` tokenize as `gh` and `7`.
// One quote-aware pass over the whole command text: quoted runs stay a single
// token (so a quoted separator cannot manufacture a segment and a quoted
// `--help` is a value, not an option), and unquoted separators end a command.
// Parens separate too — they close a subshell, terminate a case pattern, and
// open a substitution, all places a merge hides behind a non-gh first token.
// A heredoc body is data the shell never executes, so a `gh pr merge` line
// inside one must not be gated — otherwise writing a release script gets
// refused. ponytail: line-based, delimiter-matched; a `<<` inside quotes is
// not distinguished, which at worst hides a real command in the same
// (fail-open) direction as any other unparsed shape.
function stripHeredocs(text) {
  if (!text.includes("<<")) return text;
  const out = [];
  let delimiter = null;
  for (const line of text.split("\n")) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    out.push(line);
    // `<<<` is a here-string (inline data, no delimiter). Matching it made
    // every following line vanish, silently disabling the gate.
    const open = line.match(/(?<!<)<<(?!<)-?\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (open) delimiter = open[2];
  }
  return out.join("\n");
}

function tokenizeSegments(text) {
  const segments = [];
  let tokens = [];
  let current = "";
  let quote = null;
  let substitution = null;
  const endToken = () => {
    if (current) tokens.push(current);
    current = "";
  };
  const endSegment = () => {
    endToken();
    if (tokens.length) segments.push(tokens);
    tokens = [];
  };
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      // A backslash escape survives inside double quotes, so `"text \" --help"`
      // does not end the quote — treating it as the close let `--help` become
      // a real option again.
      if (char === "\\" && quote === '"' && i + 1 < text.length) {
        current += text[i + 1];
        i += 1;
      } else if (char === quote) quote = null;
      else if (char === "$" && text[i + 1] === "(") {
        // `"$(gh pr merge 7)"` still runs the command: leave quote mode for
        // the substitution so its contents are parsed as a command.
        endSegment();
        i += 1;
        substitution = quote;
        quote = null;
      } else current += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    // `` `gh pr merge 7` `` runs the merge just like $( ).
    if (char === "`") {
      endSegment();
      continue;
    }
    if (char === "\\" && i + 1 < text.length) {
      // Line continuation: the shell removes the backslash AND the newline,
      // so keeping the newline made it the PR reference.
      if (text[i + 1] === "\n") {
        i += 1;
        continue;
      }
      current += text[i + 1];
      i += 1;
      continue;
    }
    // A newline separates commands exactly like `;` — a multiline script is
    // the ordinary shape, and treating it as whitespace hid the merge.
    if (char === "\n") endSegment();
    else if (/\s/.test(char)) endToken();
    else if (char === ";") endSegment();
    else if (char === "(" || char === ")") {
      endSegment();
      if (char === ")" && substitution) {
        quote = substitution; // back inside the surrounding quotes
        substitution = null;
      } else segments.push([char]); // marker: a subshell scopes `cd`
    }
    else if (char === "&" || char === "|") {
      endSegment();
      const doubled = text[i + 1] === char;
      if (doubled) i += 1;
      // Marker: `&&`/`||` make what FOLLOWS conditional. A single `|` is a
      // pipeline, whose stages run in subshells — a `cd` there never persists.
      if (doubled) segments.push([char + char]);
      else if (char === "|") segments.push(["|"]);
    } else current += char;
  }
  endSegment();
  return segments;
}

function basename(token) {
  const cut = token.lastIndexOf("/");
  return cut < 0 ? token : token.slice(cut + 1);
}

// Reduce one shell command to gh's own arguments, or null when it is not a gh
// invocation. Strips leading env assignments and any shell wrapper, so
// `FOO=1 bash -lc "/usr/local/bin/gh pr merge 7"` still resolves.
// Drop the wrapper and its own options. `env -u GH_HOST gh …` must consume
// `GH_HOST` too, or it is left at the front and the segment stops looking
// like a gh invocation at all.
const ENV_VALUE_FLAGS = new Set(["-u", "--unset", "-C", "--chdir", "-S", "--split-string"]);
function dropWrapperFlags(tokens) {
  const isEnv = basename(tokens[0]) === "env";
  let rest = tokens.slice(1);
  let chdir = null;
  let splitString = null;
  let ignoreEnv = false;
  const unset = [];
  while (rest[0] && rest[0].startsWith("-")) {
    const token = rest[0];
    rest = rest.slice(1);
    // `--chdir=DIR` / `--unset=NAME` are documented too, so normalize the
    // attached form before matching — an exact-match-only check drops the
    // value silently and the wrapper looks like it took no argument.
    const eq = token.indexOf("=");
    const flag = eq > 0 ? token.slice(0, eq) : token;
    let value = eq > 0 ? token.slice(eq + 1) : null;
    if (isEnv && (flag === "-i" || flag === "--ignore-environment")) {
      ignoreEnv = true;
      continue;
    }
    if (isEnv && ENV_VALUE_FLAGS.has(flag)) {
      if (value === null && rest.length) {
        value = rest[0];
        rest = rest.slice(1);
      }
      // `-C DIR` runs the command from DIR, so the gate must look there too.
      if (flag === "-C" || flag === "--chdir") chdir = value;
      // `-u NAME` REMOVES the variable, so the child must not inherit it —
      // otherwise the merge runs without it while the gate runs with it.
      if ((flag === "-u" || flag === "--unset") && value) unset.push(value);
      if ((flag === "-S" || flag === "--split-string") && value) splitString = value;
    }
  }
  return { rest, chdir, unset, splitString, ignoreEnv };
}

function ghArgs(segmentTokens) {
  let tokens = segmentTokens.map((t) => t.replace(/^!+/, "")).filter(Boolean);
  const env = {};
  const unset = [];
  let chdir = null;
  let ignoreEnv = false;
  for (;;) {
    const head = tokens[0];
    if (!head) return null;
    if (CONTROL_WORDS.has(head)) {
      tokens = tokens.slice(1);
      continue;
    }
    // Keep the assignment, don't just skip it: `GH_REPO=o/r gh pr merge 7`
    // retargets the merge, and discarding it verifies PR 7 in the WRONG repo.
    const assignment = head.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (assignment) {
      env[assignment[1]] = assignment[2];
      tokens = tokens.slice(1);
      continue;
    }
    if (SHELL_WRAPPERS.has(basename(head))) {
      const dropped = dropWrapperFlags(tokens);
      if (dropped.chdir) chdir = dropped.chdir;
      if (dropped.ignoreEnv) ignoreEnv = true;
      for (const name of dropped.unset) unset.push(name);
      tokens = dropped.rest;
      continue;
    }
    break;
  }
  return basename(tokens[0]) === "gh"
    ? { tokens: tokens.slice(1), env, chdir, unset, ignoreEnv }
    : null;
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

// One pass over gh's arguments yielding positionals and real options. A
// value is never mistaken for an option: `gh pr merge 7 --body --help` uses
// `--help` as the commit body, and a token-wide scan for `--help` would skip
// the gate entirely. Everything downstream reads this, so the rule holds once.
function parseArgs(tokens) {
  const words = [];
  const flags = new Map();
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (token === "--") {
      for (const rest of tokens.slice(i + 1)) words.push(rest);
      break;
    }
    if (!token.startsWith("-")) {
      words.push(token);
      continue;
    }
    const eq = token.indexOf("=");
    const cluster = token.match(/^-([A-Za-z].*)$/);
    if (eq > 0 && token.startsWith("--")) {
      flags.set(token.slice(0, eq), token.slice(eq + 1)); // --flag=value
    } else if (cluster && !token.startsWith("--")) {
      // gh accepts clustered and attached short flags: `-iXPUT` is `-i` plus
      // `-X PUT`, `-Rowner/repo` is `-R owner/repo`. Walk the cluster; the
      // first value-taking flag consumes the remainder as its value.
      const chars = cluster[1];
      let consumed = false;
      for (let c = 0; c < chars.length; c += 1) {
        const short = "-" + chars[c];
        if (SHORT_VALUE_FLAGS.has(short)) {
          const attached = chars.slice(c + 1).replace(/^=/, "");
          if (attached) flags.set(short, attached);
          else {
            flags.set(short, tokens[i + 1] ?? true);
            i += 1;
          }
          consumed = true;
          break;
        }
        flags.set(short, true);
      }
      if (!consumed) { /* all boolean shorts recorded above */ }
    } else if (VALUE_FLAGS.has(token)) {
      flags.set(token, tokens[i + 1] ?? true);
      i += 1; // consume the value so it is never read as an option
    } else {
      flags.set(token, true);
    }
  }
  return { words, flags };
}

// EVERY merge command in this text. A shell runs them all, so checking only
// the first lets `gh pr merge 5 && gh pr merge 8` merge PR 8 unverified the
// moment PR 5 is settled. `--help` is not a merge.
// `bash -lc "gh pr merge 7"` carries its whole script as one quoted token, so
// the wrapper's payload has to be parsed as command text in its own right.
// (Codex's argv form joins to separate tokens and is handled by ghArgs.)
function wrapperScript(tokens) {
  let rest = tokens;
  // Wrappers stack: `env bash -lc '…'`, `env -C dir bash -lc '…'`. Peel each
  // layer until a script payload appears or there is no wrapper left.
  for (let depth = 0; depth < 8; depth += 1) {
    while (rest.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(rest[0])) rest = rest.slice(1);
    if (!rest.length || !SHELL_WRAPPERS.has(basename(rest[0]))) return null;
    const dropped = dropWrapperFlags(rest);
    if (dropped.splitString) return dropped.splitString; // env -S 'gh pr merge 7'
    rest = dropped.rest;
    if (rest[0] && /\s/.test(rest[0])) return rest[0];
  }
  return null;
}

function mergeCommands(text, baseCwd) {
  const found = [];
  const queue = tokenizeSegments(text);
  // `cd ../other && gh pr merge 7` resolves PR 7 in ../other, so the gate's own
  // lookup has to run there too — otherwise a settled PR 7 here authorizes an
  // unsettled PR 7 there. Tracked across segments, not interpreted deeply: an
  // unresolvable path just makes gh fail, which degrades open like any unknown.
  let cwd = baseCwd || undefined;
  const cwdStack = [];
  let conditional = false; // the previous separator was && or ||
  let pipeline = false; // the previous separator was a single |
  let cwdUnknown = false;
  // Bounded: a pathological nest cannot spin the hook inside its budget.
  for (let i = 0; i < queue.length && i < 64; i += 1) {
    const segment = queue[i];
    const script = wrapperScript(segment);
    if (script) {
      for (const sub of tokenizeSegments(script)) queue.push(sub);
      continue;
    }
    if (segment.length === 1 && (segment[0] === "&&" || segment[0] === "||")) {
      conditional = true;
      continue;
    }
    if (segment.length === 1 && segment[0] === "|") {
      pipeline = true; // stages run in subshells
      continue;
    }
    if (segment.length === 1 && (segment[0] === "(" || segment[0] === ")")) {
      // Bash restores the directory when a subshell closes.
      if (segment[0] === "(") cwdStack.push(cwd);
      else if (cwdStack.length) cwd = cwdStack.pop();
      continue;
    }
    // `if true; then cd ../other; fi` puts `cd` behind control words. Strip
    // them to see it, but treat it as conditional: the branch is not knowable.
    const bare = segment[0] !== "cd"
      ? segment.filter((t, idx) => !(idx < segment.length && CONTROL_WORDS.has(t) && segment.slice(0, idx).every((p) => CONTROL_WORDS.has(p))))
      : segment;
    if (bare[0] === "cd" && bare[1]) {
      if (bare !== segment) {
        cwdUnknown = true; // behind a control word: branch not evaluable
        conditional = false;
        continue;
      }
      // `false && cd ../other; gh pr merge 7` never runs the cd, so applying
      // it would query the wrong repository. We cannot evaluate the branch,
      // so mark the directory unknown and let the merge degrade rather than
      // verify somewhere the merge will not happen.
      // A `cd` in a pipeline stage runs in a subshell and is discarded, so it
      // must not move the gate's directory either. The `|` marker follows the
      // stage it terminates, so look ahead as well as behind.
      const piped = pipeline ||
        (queue[i + 1] && queue[i + 1].length === 1 && queue[i + 1][0] === "|");
      if (conditional) cwdUnknown = true;
      else if (!piped) cwd = path.resolve(cwd || process.cwd(), bare[1]);
      conditional = false;
      pipeline = false;
      continue;
    }
    const gh = ghArgs(segment);
    conditional = false;
    pipeline = false;
    if (!gh) continue;
    const { tokens, env } = gh;
    const unset = gh.unset;
    const ignoreEnv = gh.ignoreEnv;
    // `env -C DIR gh …` runs the merge from DIR.
    const at = gh.chdir ? path.resolve(cwd || process.cwd(), gh.chdir) : cwd;
    const { words, flags } = parseArgs(tokens);
    // `--help` prints usage; `--disable-auto` TURNS OFF auto-merge, which is
    // the mitigation to reach for during a settlement window. Refusing either
    // blocks a command that merges nothing. Checked against real options only.
    if ([...NON_MERGE_FLAGS].some((f) => flags.has(f))) continue;
    if (words[0] === "pr" && words[1] === "merge") {
      found.push({ kind: "pr", tokens, env, unset, ignoreEnv, flags, cwd: at, cwdUnknown, ref: words[2] || null });
    } else if (words[0] === "api") {
      // Only the endpoint positional — a `-H 'X-Test: repos/x/y/pulls/5/merge'`
      // header value must not be mistaken for the endpoint being called.
      const method = String(flags.get("-X") || flags.get("--method") || "GET")
        .toUpperCase();
      // gh api defaults to GET; only PUT actually merges. Refusing a
      // merge-status check would block a read-only call.
      const path = method === "PUT" ? words.join(" ").match(REST_MERGE_RE) : null;
      if (path) {
        // Placeholders expand from the current repo, exactly as `gh pr view N`
        // resolves, so hand the number to that path rather than querying a
        // literal `{owner}`.
        found.push({
          kind: "api", tokens, env, unset, ignoreEnv, flags, cwd: at, cwdUnknown, endpoint: path, ref: path[3],
        });
      } else if (tokens.some((t) => t.includes("mergePullRequest"))) {
        // A raw GraphQL merge mutation carries a PR node id, not owner/repo/
        // number, so the gate cannot verify it. ponytail: report it loudly
        // instead of passing it in silence — upgrade to resolving the node id
        // if this form ever shows up in real use.
        found.push({ kind: "graphql", tokens, env, unset, ignoreEnv, flags, cwd: at, cwdUnknown, ref: null });
      }
    }
  }
  return found;
}

// An explicit -R/--repo wins; otherwise GH_REPO on this same command, which gh
// honors for any command that would otherwise use the local repository.
// The host resolves independently of the repository, because the repo can be
// unknown (a bare number, or `{owner}` placeholders) while the host is still
// explicitly selected — and losing it there sends the settlement query to the
// wrong GitHub while the merge goes to the enterprise host.
function hostFromCommand(command) {
  const { flags, env, kind } = command;
  const explicit = flags.get("--hostname");
  if (typeof explicit === "string") return explicit;
  // `gh api` reads its host ONLY from --hostname/GH_HOST. GH_REPO there just
  // fills {owner}/{repo} placeholders, so promoting its host would query an
  // enterprise host while the REST call goes to github.com.
  if (kind !== "api") {
    const selector = [flags.get("-R"), flags.get("--repo")]
      .find((v) => typeof v === "string");
    const fromSelector = selector && parseRepo(selector);
    if (fromSelector && fromSelector.host) return fromSelector.host;
    const fromEnv = env && env.GH_REPO ? parseRepo(env.GH_REPO) : null;
    if (fromEnv && fromEnv.host) return fromEnv.host;
  }
  return (env && env.GH_HOST) || null;
}

function repoFromCommand(command) {
  const { flags, env } = command;
  const selector = [flags.get("-R"), flags.get("--repo")]
    .find((v) => typeof v === "string");
  const repo = (selector && parseRepo(selector)) ||
    (env && env.GH_REPO ? parseRepo(env.GH_REPO) : null);
  return repo ? { ...repo, host: hostFromCommand(command) } : null;
}

// owner + repo + number, or null when the command does not carry all three —
// a BARE NUMBER (`gh pr merge 7`) names the PR but not its repository, so it
// falls through to resolveViaGh. That is the common case.
function explicitTarget(command) {
  if (command.kind === "pr") {
    const url = command.ref &&
      command.ref.match(/https?:\/\/([^\s/]+)\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/);
    // Keep the URL's host even when it is github.com: an ambient enterprise
    // GH_HOST would otherwise capture this target.
    if (url) {
      return { host: url[1], owner: url[2], name: url[3], number: Number(url[4]) };
    }
  }
  if (command.kind === "api") {
    // The REST path names the repo directly — unless it is still `{owner}`,
    // which parseRepo rejects so gh resolves it the way gh itself would.
    const path = command.endpoint;
    const fromPath = path && parseRepo(`${path[1]}/${path[2]}`);
    if (fromPath) {
      return {
        ...fromPath,
        host: fromPath.host || hostFromCommand(command),
        number: Number(path[3]),
      };
    }
  }
  const repo = repoFromCommand(command);
  if (repo && command.ref && /^\d+$/.test(command.ref)) {
    return { ...repo, number: Number(command.ref) };
  }
  return null;
}

// The child's environment: pin GH_HOST whenever the host is KNOWN — including
// plain github.com, since an ambient enterprise GH_HOST would otherwise
// capture a github.com URL target — and forward any authentication the merge
// command carried inline. When the host is unknown, inherit, because gh would
// resolve the merge the same ambient way.
function ghEnv(host, captured, unset, ignoreEnv) {
  // `env -i` runs the merge with an empty environment, so inheriting the
  // ambient one would let the gate authenticate (or pick a host) in ways the
  // merge cannot. PATH is kept regardless: without it gh cannot be located,
  // and failing to spawn just degrades open.
  // ponytail: PATH-only floor; widen if a real -i case needs more.
  const env = ignoreEnv ? { PATH: process.env.PATH } : { ...process.env };
  for (const name of unset || []) delete env[name];
  if (host) env.GH_HOST = host;
  for (const key of AUTH_ENV) {
    if (captured && typeof captured[key] === "string") env[key] = captured[key];
  }
  return env;
}

// `host` routes the call at the same GitHub the merge targets, so an
// enterprise selector cannot leave the gate querying github.com.
function gh(args, timeout, { host, env, cwd, unset, ignoreEnv } = {}) {
  const budget = Math.min(timeout, DEADLINE - Date.now());
  if (budget <= 0) {
    throw new Error(
      "the gate's " + Math.round(TOTAL_BUDGET_MS / 1000) + "s budget ran out" +
        " before every merge in this command could be checked — merge one PR" +
        " per command so each gets verified",
    );
  }
  return execFileSync("gh", args, {
    encoding: "utf8",
    timeout: budget,
    env: ghEnv(host, env, unset, ignoreEnv),
    cwd,
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
  const view = JSON.parse(
    // hostFromCommand, not repo.host: the host can be explicit even when the
    // repository is not (placeholders, bare number).
    gh(args, VIEW_TIMEOUT_MS, {
      host: hostFromCommand(command),
      env: command.env,
      cwd: command.cwd,
      unset: command.unset,
      ignoreEnv: command.ignoreEnv,
    }),
  );
  // Any GitHub host, not just github.com — an enterprise URL must still parse.
  const url = String(view.url || "").match(
    /https?:\/\/([^\s/]+)\/([^\s/]+)\/([^\s/]+)\/pull\/(\d+)/,
  );
  if (!url) throw new Error("gh pr view returned no resolvable PR url");
  return {
    host: url[1],
    owner: url[2],
    name: url[3],
    number: Number(view.number || url[4]),
  };
}

function settlement(target, command) {
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
    {
      host: target.host, env: command.env, cwd: command.cwd,
      unset: command.unset, ignoreEnv: command.ignoreEnv,
    },
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
    reviews: pr.reviews?.nodes || [],
    reactions: pr.reactions?.nodes || [],
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
// Allowed, but with something the operator has to know: the merge went ahead
// past a signal that never produced a review.
const warn = (why) => ({ kind: "warn", why });

const who = (login) => login || "a reviewer";

// Has a reviewer looked at THIS head? Commit-OID equality ONLY. A review
// submitted after the head's timestamp but recorded against an older oid is
// indistinguishable from a review of the PREVIOUS head that happened to land
// late, so treating it as settlement would reopen the exact stale-review race
// this gate exists to close. Such a review is an in-progress signal instead:
// the gate waits for that reviewer to come back to the new head.
function reviewedHead(state) {
  return state.reviews.some(
    (review) => review && review.state !== "PENDING" &&
      review.commit?.oid === state.head,
  );
}

// Reviewers that have shown intent on this head but have not posted yet. Each
// entry is a phrase the refusal names, so the model can see WHAT it is waiting
// on instead of just a clock.
// Signals are matched to reviewer IDENTITY, not counted in aggregate: one
// reviewer landing on the head does not discharge another reviewer's 👀. So a
// signal is dropped only when THAT reviewer has posted on this head, which is
// also what keeps a reviewer's own earlier reaction from outliving their
// review.
// ponytail: reactions and reviews only — an interim "I'm on it" comment is a
// weaker signal and a human's ordinary comment would read as one, holding the
// merge for the full cap. Add comment scanning if bots stop reacting.
function inProgressSignals(state, committed) {
  const landed = new Set();
  for (const review of state.reviews) {
    if (review && review.state !== "PENDING" && review.commit?.oid === state.head) {
      landed.add(who(review.author?.login));
    }
  }
  const signals = [];
  const earlier = new Set();
  for (const review of state.reviews) {
    const login = who(review?.author?.login);
    if (landed.has(login)) continue;
    if (review?.state === "PENDING") {
      signals.push("a pending (unsubmitted) review from " + login);
    } else if (review?.commit?.oid && review.commit.oid !== state.head) {
      earlier.add(login);
    }
  }
  for (const reaction of state.reactions) {
    const login = who(reaction?.user?.login);
    if (landed.has(login)) continue;
    const at = reaction?.createdAt ? Date.parse(reaction.createdAt) : NaN;
    // An unreadable head date leaves "after the push" undecidable, so a
    // reaction contributes nothing rather than blocking on a guess.
    if (!Number.isNaN(at) && !Number.isNaN(committed) && at >= committed) {
      signals.push("a 👀 reaction from " + login + " after the head push");
    }
  }
  for (const login of earlier) {
    signals.push(login + " reviewed an earlier head and has not reviewed this one yet");
  }
  return signals;
}

// One command's verdict. Pure decision over gathered facts, so the handler
// below stays a loop over commands rather than a nest of branches.
function verdictFor(command) {
  if (command.cwdUnknown) {
    return degrade(
      "a conditional `cd` in this command means the merge's working directory" +
        " is not knowable without running the shell, so the gate cannot tell" +
        " which repository it would verify. Run the merge as its own command",
    );
  }
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
    state = settlement(target, command);
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

  const committed = state.committedDate ? Date.parse(state.committedDate) : NaN;
  const signals = inProgressSignals(state, committed);

  // Fast path: this head has a review, nothing is unresolved, and no OTHER
  // reviewer is still registered. Every reviewer that was coming has arrived,
  // so there is no clock left to run. One reviewer finishing does not speak
  // for another whose 👀 is still outstanding — that would merge out from
  // under the reviewer who announced they were looking.
  if (reviewedHead(state) && !signals.length) return ALLOW;

  if (Number.isNaN(committed)) {
    return degrade("could not read the head commit date for PR #" + target.number);
  }

  const head = state.head.slice(0, 7);
  const age = Date.now() - committed;

  if (!signals.length) {
    // Nobody has registered. Inside the registration window that is
    // indistinguishable from a bot that has not woken up yet; past it, it means
    // no reviewer is coming — so allow, and never block a repository that
    // genuinely has no reviewers.
    if (age >= REGISTRATION_WINDOW_MS) return ALLOW;
    return refuse(
      "the head commit " + head + " of PR #" + target.number + " has no review" +
        " and no reviewer has registered on it, and it is only " +
        humanDuration(age) + " old. Bot reviewers (Copilot, the Codex" +
        " connector, CodeRabbit) register within ~1-3 minutes of a push — a 👀" +
        " reaction, a pending review — so this is too early to tell silence" +
        " from a reviewer that has not woken up yet, and green CI is not merge" +
        " authority. Wait " + humanDuration(REGISTRATION_WINDOW_MS - age) +
        " more (registration window " + humanDuration(REGISTRATION_WINDOW_MS) +
        " from the head commit), then retry — if nothing has registered by" +
        " then the gate allows the merge, so waiting is always sufficient. Do" +
        " not bypass this guard.",
    );
  }

  if (age < SIGNAL_CAP_MS) {
    return refuse(
      "PR #" + target.number + " has a review still in progress on head " +
        head + " — " + signals.join("; ") + " — so the review evidence for this" +
        " head is incomplete (head is " + humanDuration(age) +
        " old). A reviewer that registered is a reviewer" +
        " whose findings are still coming, and reviews that arrive after CI" +
        " turns green are still real findings. Wait for the review to post, or" +
        " at most " + humanDuration(SIGNAL_CAP_MS - age) + " more (hard cap " +
        humanDuration(SIGNAL_CAP_MS) + " from the head commit), after which the" +
        " gate allows the merge regardless — so waiting is always sufficient." +
        " Do not bypass this guard.",
    );
  }

  // Past the cap with the signal still unfulfilled: a flaky or abandoned
  // reviewer must not lock the repository. Allow, but say what was left behind.
  return warn(
    "PR #" + target.number + " still shows " + signals.join("; ") +
      ", but that never produced a review on head " + head + " in " + humanDuration(age) +
      " (hard cap " + humanDuration(SIGNAL_CAP_MS) + " from the head commit)." +
      " The signal is stale, so the merge proceeds without that review.",
  );
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
  // Codex's shell tools carry a per-call directory; the merge runs there, so
  // the gate's lookup must too. Falls back to the hook payload's own cwd.
  const requestedCwd = [args.working_directory, args.workdir, args.cwd, input.cwd]
    .find((value) => typeof value === "string" && value);
  const commands = mergeCommands(stripHeredocs(text), requestedCwd);
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
    if (v.kind === "warn") {
      // Judged, allowed, and not silent: the gate knows exactly what it waived.
      process.stderr.write(
        "[railyard] Merge-settlement gate WARNING (allowing the merge): " +
          v.why + "\n",
      );
      continue;
    }
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
