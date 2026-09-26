#!/usr/bin/env node
// PreToolUse: consume CE's final pr-snapshot stdout, selected by the CE owner
// after its readiness judgment. CE owns review settlement and CI policy.
// This adapter checks the supplied evidence and current PR identity; it does
// not watch reviewers, infer settlement from elapsed time, or authorize merges.
// Missing, stale or unknown evidence refuses a detected merge actionably.
const { execFileSync } = require("child_process");
const { readFileSync, statSync } = require("fs");
const path = require("path");

const VIEW_TIMEOUT_MS = 1200;
const GRAPHQL_TIMEOUT_MS = 2500;
const TOTAL_BUDGET_MS = 4000;
const DEADLINE = Date.now() + TOTAL_BUDGET_MS;
// Evidence freshness only: expiry asks CE for a current observation; it never
// starts a wait or substitutes for CE's review-still-coming judgment.
const EVIDENCE_MAX_AGE_MS = 5 * 60 * 1000;
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;
const IDENTITY_QUERY = `
query($owner:String!,$name:String!,$number:Int!){
  repository(owner:$owner,name:$name){
    pullRequest(number:$number){
      url state isDraft headRefOid baseRefName mergeable mergeStateStatus
      baseRef{target{oid}}
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
// Forward inline authentication so the identity read uses the same account
// as the requested merge. Authentication failures refuse the merge.
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
const flagEnabled = (value) => value !== undefined && !/^(?:false|f|0)$/i.test(String(value));
const REST_MERGE_RE = /repos\/([^\s/]+)\/([^\s/]+)\/pulls\/(\d+)\/merge/;

// Also sheds grouping punctuation, so `(gh` and `7)` tokenize as `gh` and `7`.
// One quote-aware pass over the whole command text: quoted runs stay a single
// token (so a quoted separator cannot manufacture a segment and a quoted
// `--help` is a value, not an option), and unquoted separators end a command.
// Parens separate too — they close a subshell, terminate a case pattern, and
// open a substitution, all places a merge hides behind a non-gh first token.
// A heredoc body is data the shell never executes, so a `gh pr merge` line
// inside one must not be gated — otherwise writing a release script gets
// refused. Only an unquoted operator starts a heredoc; quoted `<<EOF` is data
// and must never hide a later executable merge.
function heredocDelimiter(line, lexical) {
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && lexical.quote !== "'") { index += 1; continue; }
    if (lexical.quote) {
      if (char === lexical.quote) lexical.quote = null;
      continue;
    }
    if (char === "'" || char === '"') { lexical.quote = char; continue; }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) return null;
    if (char !== "<" || line[index - 1] === "<" || line[index + 1] !== "<" || line[index + 2] === "<") continue;
    const match = line.slice(index).match(/^<<-?[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    return match ? match[2] : null;
  }
  return null;
}

function stripHeredocs(text) {
  if (!text.includes("<<")) return text;
  const out = [];
  let delimiter = null;
  const lexical = { quote: null }; // Shell quotes may span physical lines.
  for (const line of text.split("\n")) {
    if (delimiter !== null) {
      if (line.trim() === delimiter) delimiter = null;
      continue;
    }
    out.push(line);
    // `<<<` is a here-string (inline data, no delimiter). Matching it made
    // every following line vanish, silently disabling the gate.
    delimiter = heredocDelimiter(line, lexical);
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
      else if (quote === '"' && char === "$" && text[i + 1] === "(") {
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

// Peel only the known env/shell wrappers. Keep their context with an extracted
// script instead of re-parsing it later against the hook's ambient settings.
function commandPrefix(segmentTokens, baseCwd, inherited = {}) {
  let tokens = segmentTokens.map((t) => t.replace(/^!+/, "")).filter(Boolean);
  const context = {
    env: { ...inherited.env }, unset: [...(inherited.unset || [])],
    ignoreEnv: inherited.ignoreEnv || false, cwd: baseCwd,
    cwdUnknown: inherited.cwdUnknown || false,
  };
  for (;;) {
    const head = tokens[0];
    if (!head) return { ...context, tokens };
    if (CONTROL_WORDS.has(head)) { tokens = tokens.slice(1); continue; }
    const assignment = head.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
    if (assignment) {
      context.env[assignment[1]] = assignment[2];
      context.unset = context.unset.filter((name) => name !== assignment[1]);
      tokens = tokens.slice(1);
      continue;
    }
    if (!SHELL_WRAPPERS.has(basename(head))) return { ...context, tokens };
    const dropped = dropWrapperFlags(tokens);
    if (dropped.ignoreEnv) {
      context.env = {};
      context.unset = [];
      context.ignoreEnv = true;
    }
    for (const name of dropped.unset) {
      delete context.env[name];
      if (!context.unset.includes(name)) context.unset.push(name);
    }
    if (dropped.chdir) {
      if (/[\$`]/.test(dropped.chdir)) context.cwdUnknown = true;
      else context.cwd = path.resolve(context.cwd || process.cwd(), dropped.chdir);
    }
    if (dropped.splitString) return { ...context, script: dropped.splitString };
    tokens = dropped.rest;
    if (basename(head) !== "env" && tokens[0] && /\s/.test(tokens[0])) {
      return { ...context, script: tokens[0] };
    }
  }
}

// gh accepts `[HOST/]OWNER/REPO`. Keep the HOST: dropping it makes the gate
// query github.com while the merge targets an enterprise host, which usually
// fails verification and lets an unsettled merge through. An unexpanded
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
    if (eq > 0 && (token.startsWith("--") || /^-[A-Za-z]=/.test(token))) {
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
// (Codex's argv form joins to separate tokens and is handled by commandPrefix.)
function mergeCommands(text, baseCwd, inherited = {}, depth = 0) {
  const found = [];
  const queue = tokenizeSegments(text);
  // `cd ../other && gh pr merge 7` resolves PR 7 in ../other, so the gate's own
  // lookup has to run there too — otherwise a settled PR 7 here authorizes an
  // unsettled PR 7 there. Tracked across segments, not interpreted deeply: an
  // unresolvable path just makes gh fail, which the gate refuses as unknown.
  let cwd = baseCwd || undefined;
  const cwdStack = [];
  let conditional = false; // the previous separator was && or ||
  let pipeline = false; // the previous separator was a single |
  let cwdUnknown = inherited.cwdUnknown || false;
  // Bounded: a pathological nest cannot spin the hook inside its budget.
  for (let i = 0; i < queue.length && i < 64; i += 1) {
    const segment = queue[i];
    const prefix = commandPrefix(segment, cwd, { ...inherited, cwdUnknown });
    if (prefix.script && depth < 8) {
      found.push(...mergeCommands(prefix.script, prefix.cwd, prefix, depth + 1));
      conditional = false;
      pipeline = false;
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
    conditional = false;
    pipeline = false;
    if (!prefix.tokens || basename(prefix.tokens[0] || "") !== "gh") continue;
    const { env, unset, ignoreEnv } = prefix;
    const tokens = prefix.tokens.slice(1);
    const at = prefix.cwd;
    const commandCwdUnknown = prefix.cwdUnknown;
    const { words, flags } = parseArgs(tokens);
    // `--help` prints usage; `--disable-auto` TURNS OFF auto-merge, which is
    // the mitigation to reach for during a settlement window. Refusing either
    // blocks a command that merges nothing. Checked against real options only.
    if ([...NON_MERGE_FLAGS].some((f) => flagEnabled(flags.get(f)))) continue;
    if (words[0] === "pr" && words[1] === "merge") {
      found.push({ kind: "pr", tokens, env, unset, ignoreEnv, flags, cwd: at, cwdUnknown: commandCwdUnknown, ref: words[2] || null });
    } else if (words[0] === "api") {
      // Only the endpoint positional — a `-H 'X-Test: repos/x/y/pulls/5/merge'`
      // header value must not be mistaken for the endpoint being called.
      const method = String(flags.get("-X") || flags.get("--method") || "GET")
        .toUpperCase();
      // gh api defaults to GET; only PUT actually merges. Refusing a
      // merge-status check would block a read-only call.
      const endpoint = words[1];
      const path = typeof endpoint === "string" ? endpoint.match(REST_MERGE_RE) : null;
      if (path && method === "PUT") {
        // Placeholders expand from the current repo, exactly as `gh pr view N`
        // resolves, so hand the number to that path rather than querying a
        // literal `{owner}`.
        found.push({
          kind: "api", tokens, env, unset, ignoreEnv, flags, cwd: at, cwdUnknown: commandCwdUnknown, endpoint: path, ref: path[3],
        });
      } else if ((method === "PUT" && (!endpoint || /[$`]/.test(endpoint))) ||
          (path && /[$`]/.test(method))) {
        found.push({ kind: "unsupported", why: "the gh api merge endpoint or method is unresolved; use a literal REST PUT endpoint or gh pr merge with --match-head-commit" });
      } else if (endpoint === "graphql") {
        const command = { tokens, env, unset, ignoreEnv, flags, cwd: at, cwdUnknown: commandCwdUnknown };
        try {
          if (graphqlMerges(command)) found.push({ ...command, kind: "graphql", ref: null });
        } catch (error) {
          found.push({ kind: "unsupported", why: String(error.message) });
        }
      }
    }
  }
  return found;
}

// An explicit -R/--repo wins; otherwise GH_REPO on this same command, which gh
// honors for any command that would otherwise use the local repository.
// The host resolves independently of the repository, because the repo can be
// unknown (a bare number, or `{owner}` placeholders) while the host is still
// explicitly selected — and losing it there sends the identity query to the
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
  // and failing to spawn just fails verification.
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

// The snapshot is unchanged CE stdout, beside CE's atomic state.json. Passing
// its path asserts that CE's owner completed the appropriate readiness judgment;
// CE 3.25 does not persist that semantic verdict in state.json or BABYSIT_WAKE.
function commandSetting(command, name) {
  if (Object.hasOwn(command.env, name)) return command.env[name];
  if (command.ignoreEnv || command.unset.includes(name)) return undefined;
  return process.env[name];
}

function readRegularText(filename) {
  const info = statSync(filename);
  if (!info.isFile() || info.size > MAX_EVIDENCE_BYTES) throw new Error("unsupported input file");
  return readFileSync(filename, "utf8");
}

function readObject(filename, label) {
  let value;
  try { value = JSON.parse(readRegularText(filename)); }
  catch { throw new Error(`${label} is missing, unreadable or invalid JSON; use a regular JSON file no larger than 8 MiB`); }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value;
}

function prIdentity(value) {
  const match = typeof value === "string" && value.match(
    /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)\/?$/,
  );
  if (!match) return null;
  return { host: match[1].toLowerCase(), owner: match[2].toLowerCase(),
    name: match[3].toLowerCase(), number: Number(match[4]) };
}

function samePr(left, right) {
  return left && right && ["host", "owner", "name", "number"].every(
    (key) => String(left[key]).toLowerCase() === String(right[key]).toLowerCase(),
  );
}

function nonempty(value) { return typeof value === "string" && value.length > 0; }
const SHA = /^[a-f0-9]{40}$/i;
const empty = (value) => Array.isArray(value) && value.length === 0;

function ceEvidence(command) {
  const filename = commandSetting(command, "RAILYARD_CE_SNAPSHOT");
  if (!filename || !path.isAbsolute(filename)) {
    throw new Error("set RAILYARD_CE_SNAPSHOT to the absolute path of CE's final snapshot JSON beside its state.json");
  }
  const mode = commandSetting(command, "RAILYARD_CE_MODE") || "pipeline";
  if (mode !== "pipeline" && mode !== "interactive") {
    throw new Error("RAILYARD_CE_MODE must be pipeline or interactive");
  }
  const snapshot = readObject(filename, "CE snapshot");
  const state = readObject(path.join(path.dirname(filename), "state.json"), "CE state.json");
  const identity = prIdentity(snapshot.url);
  if (!identity || !samePr(identity, prIdentity(state.pr?.url)) ||
      state.pr?.number !== identity.number ||
      String(state.pr?.owner).toLowerCase() !== identity.owner ||
      String(state.pr?.repo).toLowerCase() !== identity.name) {
    throw new Error("CE snapshot and state.json do not identify the same PR");
  }
  if (!nonempty(snapshot.invocation_id) || snapshot.invocation_id !== state.invocation_id ||
      !Number.isInteger(snapshot.tick) || snapshot.tick < 1 || snapshot.tick !== state.tick ||
      !SHA.test(snapshot.head_sha || "") || snapshot.head_sha !== state.head_sha) {
    throw new Error("CE snapshot is not the latest invocation, tick and head recorded in state.json");
  }
  const activityAt = Date.parse(state.last_activity_at);
  const startedAt = Date.parse(snapshot.invocation_started_at);
  const elapsed = snapshot.invocation_wall_elapsed_seconds;
  if (!Number.isFinite(activityAt) || activityAt > Date.now() ||
      Date.now() - activityAt > EVIDENCE_MAX_AGE_MS) {
    throw new Error("CE evidence is stale or has an invalid last_activity_at; obtain a current CE snapshot (within five minutes)");
  }
  // A watcher poll can change the observed state without advancing tick. Bind
  // stdout's observation clock too, so a later poll/mark cannot freshen an old
  // snapshot. CE floors wall elapsed seconds; its timestamp is within that second.
  const observedAt = startedAt + elapsed * 1000;
  if (!Number.isFinite(startedAt) || snapshot.invocation_started_at !== state.started_at ||
      !Number.isInteger(elapsed) || elapsed < 0 ||
      activityAt - observedAt < -1 || activityAt - observedAt > 1001) {
    throw new Error("CE snapshot predates the latest state observation; save the latest snapshot stdout again");
  }
  const base = snapshot.base;
  if (!base || !state.base ||
      !["host", "repository", "ref", "oid", "identity"].every(
        (key) => nonempty(base[key]) && base[key] === state.base[key]) ||
      !SHA.test(base.oid) || base.host.toLowerCase() !== identity.host ||
      base.repository.toLowerCase() !== `${identity.owner}/${identity.name}`) {
    throw new Error("CE snapshot and state.json do not bind the same current base identity");
  }
  if (state.stop_reason != null || snapshot.stop_reason != null) {
    throw new Error("CE recorded a stop reason; obtain CE's completed readiness result before merging");
  }
  if (snapshot.pr_state !== "OPEN" || snapshot.pr_is_draft !== false ||
      snapshot.mergeability_certain !== true || snapshot.mergeable !== "MERGEABLE" ||
      snapshot.merge_state_status !== "CLEAN" || state.mergeable !== snapshot.mergeable ||
      state.merge_state_status !== snapshot.merge_state_status) {
    throw new Error("CE has not reported an open, non-draft, certain MERGEABLE/CLEAN PR");
  }
  if (snapshot.checks_terminal !== true || snapshot.has_failing_checks !== false ||
      snapshot.checks_awaiting_approval !== 0 || state.awaiting_approval !== 0 ||
      snapshot.blocked_external !== false || typeof snapshot.checks_present !== "boolean" ||
      snapshot.all_checks_ok !== snapshot.checks_present ||
      (mode === "pipeline" && snapshot.all_checks_ok !== true)) {
    throw new Error(`CE's ${mode} check conditions are not satisfied; return to ce-babysit-pr`);
  }
  for (const field of ["base_ref_blocker", "stack_blocker", "branch_currency_blocker", "unrequested_base_merge"]) {
    if (snapshot[field] !== null) throw new Error(`CE ${field} is present or unknown`);
  }
  if (snapshot.unrequested_base_merge_pending !== false || snapshot.open_needs_human !== 0 ||
      !empty(snapshot.needs_human_residuals) || !empty(snapshot.needs_human_ids) ||
      !["ci", "threads", "comments", "needs_human"].every((key) => snapshot.counts?.[key] === 0) ||
      !["ci", "threads", "comments"].every((key) => empty(snapshot.actionable?.[key]))) {
    throw new Error("CE has unresolved work, a pending base change, or a needs-human residual");
  }
  return { snapshot, identity };
}

function requestFieldEntries(tokens, name) {
  const values = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    let value;
    let typed = false;
    if (["-f", "-F", "--raw-field", "--field"].includes(token)) {
      value = tokens[++index];
      typed = token === "-F" || token === "--field";
    }
    else {
      const attached = token.match(/^(-[fF]=?|--(?:raw-field|field)=)(.+)$/);
      if (attached) {
        value = attached[2];
        typed = attached[1].startsWith("-F") || attached[1] === "--field=";
      }
    }
    if (typeof value === "string" && value.startsWith(`${name}=`)) values.push({ value: value.slice(name.length + 1), typed });
  }
  return values;
}

function requestFields(tokens, name) {
  return requestFieldEntries(tokens, name).map((entry) => entry.value);
}

function requestFile(value, cwd) {
  if (!nonempty(value) || value === "-" || /[$`]/.test(value)) {
    throw new Error("GraphQL request content is unresolved; supply a literal query or an existing regular input file, without shell evaluation");
  }
  return path.resolve(cwd || process.cwd(), value);
}

function graphqlMerges(command) {
  if (command.cwdUnknown) throw new Error("the GraphQL request's working directory is unresolved; use an explicit workdir and literal query or input file");
  const queries = requestFieldEntries(command.tokens, "query");
  if (command.flags.has("--input")) {
    const body = readObject(requestFile(command.flags.get("--input"), command.cwd), "GraphQL input request");
    if (!nonempty(body.query)) throw new Error("GraphQL input request has no literal query; supply a readable JSON request with its query field");
    queries.push({ value: body.query, typed: false });
  }
  if (!queries.length) throw new Error("GraphQL request content is unresolved; supply a literal query or an existing regular input file");
  return queries.map(({ value, typed }) => {
    let source = value;
    if (typed && source.startsWith("@")) {
      try { source = readRegularText(requestFile(source.slice(1), command.cwd)); }
      catch (error) {
        throw new Error("GraphQL query file is unreadable or unresolved; use a literal path to a regular file no larger than 8 MiB: " + error.message);
      }
    }
    // GraphQL variables inside a literal operation are protocol data. An
    // entire shell variable/query expression is not evaluated by this hook.
    const syntax = source.replace(/"(?:\\.|[^"\\])*"|#[^\n]*/g, "").trim();
    if (!/^(?:query\b|mutation\b|subscription\b|fragment\b|\{)/.test(syntax)) {
      throw new Error("GraphQL query content is unresolved; pass the literal operation or an existing regular query file");
    }
    // Fragments may precede the operation that uses them, so the mutation
    // and merge field need not appear in that order within the document.
    return /\bmutation\b/.test(syntax) && /\bmergePullRequest\s*\(/.test(syntax);
  }).some(Boolean);
}

function restSha(command) {
  if (command.flags.has("--input")) return null;
  const values = requestFields(command.tokens, "sha");
  return values.length === 1 ? values[0] : null;
}

function currentIdentity(target, command) {
  const raw = gh([
    "api", "graphql", "-f", `query=${IDENTITY_QUERY}`,
    "-F", `owner=${target.owner}`, "-F", `name=${target.name}`, "-F", `number=${target.number}`,
  ], GRAPHQL_TIMEOUT_MS, {
    host: target.host, env: command.env, cwd: command.cwd,
    unset: command.unset, ignoreEnv: command.ignoreEnv,
  });
  const response = JSON.parse(raw);
  const pr = response?.data?.repository?.pullRequest;
  if (response.errors?.length || !pr) throw new Error("GitHub returned no certain current PR identity");
  return pr;
}

function verifyMerge(command) {
  if (command.kind === "unsupported") throw new Error(command.why);
  if (command.cwdUnknown) {
    throw new Error("a conditional `cd` makes the merge's repository unknown; run the merge as its own command in an explicit workdir");
  }
  if (command.kind === "graphql") {
    throw new Error("raw GraphQL mergePullRequest is unsupported; use gh pr merge with --match-head-commit and CE's snapshot");
  }
  if (flagEnabled(command.flags.get("--auto"))) {
    throw new Error("--auto can queue a future merge beyond this evidence; merge immediately after CE settles with --match-head-commit");
  }
  const { snapshot, identity } = ceEvidence(command);
  const guardedHead = command.kind === "api" ? restSha(command) : command.flags.get("--match-head-commit");
  if (guardedHead !== snapshot.head_sha) {
    throw new Error(command.kind === "api"
      ? "the REST merge must supply exactly one literal sha field matching CE's head (no --input); use gh pr merge --match-head-commit " + snapshot.head_sha
      : "gh pr merge must pin CE's head with --match-head-commit " + snapshot.head_sha);
  }
  const target = explicitTarget(command) || resolveViaGh(command);
  // A selector without a host follows GH_HOST, just as gh does. A URL or an
  // enterprise selector has already pinned the host in explicitTarget.
  target.host ||= ghEnv(null, command.env, command.unset, command.ignoreEnv).GH_HOST || "github.com";
  if (!samePr(identity, target)) {
    throw new Error(`CE snapshot is for ${snapshot.url}, not the selected PR #${target.number}`);
  }
  const current = currentIdentity(target, command);
  if (!samePr(identity, prIdentity(current.url)) || current.state !== "OPEN" ||
      current.isDraft !== false || current.headRefOid !== snapshot.head_sha ||
      current.baseRefName !== snapshot.base.ref || current.baseRef?.target?.oid !== snapshot.base.oid ||
      current.mergeable !== "MERGEABLE" || current.mergeStateStatus !== "CLEAN") {
    throw new Error("the live PR head, current base or merge state differs from CE's snapshot; return to CE for a current result");
  }
}

// A user who explicitly directs a merge (including an admin bypass of branch
// protection) can skip CE settlement for that one command. The override must
// be an inline assignment on the merge command itself, never ambient process
// env, so it cannot linger as a blanket bypass and stays visible in the
// command the user approved.
const OVERRIDE_NAME = "RAILYARD_MERGE_OVERRIDE";
const OVERRIDE_VALUE = "user-approved";
function userOverride(command) {
  return Boolean(command.env) && Object.hasOwn(command.env, OVERRIDE_NAME) &&
    command.env[OVERRIDE_NAME] === OVERRIDE_VALUE;
}

function handlePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  const args = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const text = commandText(args);
  if (!text) return;
  const requestedCwd = [args.working_directory, args.workdir, args.cwd, input.cwd]
    .find((value) => typeof value === "string" && value);
  const detected = mergeCommands(stripHeredocs(text), requestedCwd);
  const commands = detected.filter((command) => !userOverride(command));
  if (detected.length !== commands.length) {
    process.stderr.write(`[railyard] Merge allowed by ${OVERRIDE_NAME}=${OVERRIDE_VALUE} without CE settlement.\n`);
  }
  if (!commands.length) return;
  try {
    if (commands.length !== 1) throw new Error("merge one PR per command with that PR's CE snapshot");
    verifyMerge(commands[0]);
  } catch (error) {
    const why = String(error?.message || error).split("\n")[0];
    process.stderr.write("[railyard] Merge refused: " + why +
      ". Have ce-babysit-pr complete readiness and save its final snapshot stdout beside state.json; then retry the pinned merge." +
      ` Only when the user explicitly directs this merge without CE settlement, prefix the merge command with ${OVERRIDE_NAME}=${OVERRIDE_VALUE}.\n`);
    process.exitCode = 2;
  }
}

let raw = "";
let inputHandled = false;
let inputTimer;
function handleInput({ final = false } = {}) {
  if (inputHandled) return;
  if (inputTimer) clearTimeout(inputTimer);
  let input;
  try { input = JSON.parse(raw); } catch {
    if (final) inputHandled = true;
    return;
  }
  inputHandled = true;
  handlePayload(input);
}
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  raw += chunk;
  if (inputTimer) clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    handleInput();
    if (inputHandled) process.exit(process.exitCode || 0);
  }, 50);
});
process.stdin.on("end", () => handleInput({ final: true }));
// Native hook runners may leave stdin open; complete JSON still finishes promptly.
