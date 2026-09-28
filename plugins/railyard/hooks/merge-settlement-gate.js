#!/usr/bin/env node
// PreToolUse: consume CE's final pr-snapshot stdout, selected by the CE owner
// after its readiness judgment. CE owns review settlement and CI policy.
// This adapter checks the supplied evidence and current PR identity; it does
// not watch reviewers, infer settlement from elapsed time, or authorize merges.
// Missing, stale or unknown evidence refuses a detected merge actionably.
const { execFileSync } = require("child_process");
const { readFileSync, statSync } = require("fs");
const path = require("path");
const { evaluateOverride } = require("./merge-override");
const {
  CONTROL_WORDS, SAFE_FILTERS, basename, commandPrefix, commandScript, mergePhraseCount, parseArgs,
  pushPhraseCount, runsScript, stripHeredocs, tokenizeSegments,
} = require("./shell-command");

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

// Forward inline authentication so the identity read uses the same account
// as the requested merge. Authentication failures refuse the merge.
const AUTH_ENV = [
  "GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN",
  // gh resolves its config dir as GH_CONFIG_DIR, then $XDG_CONFIG_HOME/gh,
  // then $HOME/.config/gh — so credentials can live behind any of these.
  "GH_CONFIG_DIR", "XDG_CONFIG_HOME", "HOME",
];
const NON_MERGE_FLAGS = new Set(["--help", "-h", "--disable-auto"]);
const flagEnabled = (value) => value !== undefined && !/^(?:false|f|0)$/i.test(String(value));
// Anchored: the whole endpoint must be the literal REST merge path. Anything
// else that still looks like a merge endpoint (a `${P}` prefix, an absolute
// URL, a query string) cannot be tied to a repository and is unsupported.
const REST_MERGE_RE = /^\/?repos\/([^\s/]+)\/([^\s/]+)\/pulls\/(\d+)\/merge\/?$/;
const LOOSE_MERGE_RE = /pulls\/[^\s/]*\/merge(?![\w-])/i;

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

// Parser bound: a pathological script cannot spin the hook inside its budget.
// A merge phrase past it is simply unattributed, so it refuses.
const SEGMENT_CAP = 512;

// gh aliases from the user's gh config (`aliases:` in config.yml), read once
// per hook run. An unreadable config means no aliases; it never blocks.
// gh reads aliases from GH_CONFIG_DIR, else $XDG_CONFIG_HOME/gh, else
// ~/.config/gh, as the command itself sees them (inline or exported earlier
// in the script). null when that directory is not a literal path.
const aliasCache = new Map();
function ghAliases(command = { env: {}, unset: [], ignoreEnv: false }) {
  const setting = (name) => commandSetting(command, name);
  const dir = setting("GH_CONFIG_DIR") ||
    path.join(setting("XDG_CONFIG_HOME") || path.join(setting("HOME") || "", ".config"), "gh");
  if (/[$`~*?[\]]/.test(dir)) return null;
  if (aliasCache.has(dir)) return aliasCache.get(dir);
  const aliases = new Map();
  aliasCache.set(dir, aliases);
  let text = "";
  try { text = readRegularText(path.join(dir, "config.yml")); } catch { return aliases; }
  let inAliases = false;
  for (const line of text.split("\n")) {
    if (/^\S/.test(line)) { inAliases = /^aliases:\s*$/.test(line); continue; }
    const entry = inAliases && line.match(/^\s+([^\s:#][^:]*?):\s*(.*?)\s*$/);
    if (entry) aliases.set(entry[1].replace(/^['"]|['"]$/g, ""), entry[2].replace(/^(['"])(.*)\1$/, "$2"));
  }
  return aliases;
}
// gh's own commands, which no alias can shadow.
const GH_COMMANDS = new Set([
  "accessibility", "agent-task", "alias", "api", "attestation", "auth", "browse", "cache", "codespace",
  "completion", "config", "copilot", "extension", "gist", "gpg-key", "help", "issue", "label", "org", "pr",
  "preview", "project", "release", "repo", "ruleset", "run", "search", "secret", "ssh-key", "status",
  "variable", "version", "workflow",
]);
// Alias names whose expansion is itself a merge.
const mergeAliasNames = () => [...(ghAliases() || [])].filter(([, expansion]) => mergePhraseCount(expansion)).map(([name]) => name);

// One simple command's merge, if it is one. `--help` is not a merge.
function mergeFromPrefix(prefix) {
  let tokens = prefix.tokens.slice(1);
  const name = tokens.find((token) => !token.startsWith("-"));
  const aliases = ghAliases(prefix);
  if (aliases === null && name !== undefined && !GH_COMMANDS.has(name)) {
    return { kind: "unsupported", why: "gh reads its aliases from a config directory this guard cannot resolve; run gh pr merge directly" };
  }
  const alias = aliases?.get(name);
  if (alias !== undefined) {
    // A shell alias (`!…`) runs through sh, so what it does cannot be read
    // from its text; one with `$1` placeholders cannot be expanded here.
    if (alias.startsWith("!")) {
      return { kind: "unsupported", why: "a gh shell alias runs commands this guard cannot inspect; run them directly" };
    }
    if (/\$\d|\$@|\$\*/.test(alias)) {
      return mergePhraseCount(alias)
        ? { kind: "unsupported", why: "a gh alias runs a merge this guard cannot expand; run gh pr merge directly" }
        : null;
    }
    const at = tokens.findIndex((token) => !token.startsWith("-"));
    tokens = [...tokens.slice(0, at), ...alias.split(/\s+/).filter(Boolean), ...tokens.slice(at + 1)];
  }
  const { env, unset, ignoreEnv } = prefix;
  const { words, flags } = parseArgs(tokens);
  // `gh pr${IFS}merge` or `gh "$SUB" merge`: a computed subcommand.
  if (/[$`*?[\]{}]/.test(words[0] || "") || (words[0] === "pr" && /[$`*?[\]{}]/.test(words[1] || ""))) {
    return { kind: "unsupported", why: "the gh subcommand is computed; run gh pr merge with literal words" };
  }
  // `--help` prints usage; `--disable-auto` TURNS OFF auto-merge, which is
  // the mitigation to reach for during a settlement window. Refusing either
  // blocks a command that merges nothing. Checked against real options only.
  if ([...NON_MERGE_FLAGS].some((f) => flagEnabled(flags.get(f)))) return null;
  const base = { tokens, env, unset, ignoreEnv, flags, cwd: prefix.cwd, cwdUnknown: prefix.cwdUnknown };
  if (words[0] === "pr" && words[1] === "merge") return { ...base, kind: "pr", ref: words[2] || null };
  if (words[0] !== "api") return null;
  // Only the endpoint positional — a `-H 'X-Test: repos/x/y/pulls/5/merge'`
  // header value must not be mistaken for the endpoint being called.
  const method = String(flags.get("-X") || flags.get("--method") || "GET").toUpperCase();
  // gh api defaults to GET; only PUT actually merges. Refusing a merge-status
  // check would block a read-only call.
  const endpoint = words[1];
  const route = typeof endpoint === "string" ? endpoint.match(REST_MERGE_RE) : null;
  if (route && method === "PUT") {
    // Placeholders expand from the current repo, exactly as `gh pr view N`
    // resolves, so hand the number to that path rather than a literal `{owner}`.
    return { ...base, kind: "api", endpoint: route, ref: route[3] };
  }
  if ((method === "PUT" && (!endpoint || /[$`]/.test(endpoint) || LOOSE_MERGE_RE.test(endpoint))) ||
      ((route || LOOSE_MERGE_RE.test(endpoint || "")) && /[$`]/.test(method))) {
    return { kind: "unsupported", why: "the gh api merge endpoint or method is unresolved; use a literal REST PUT endpoint or gh pr merge with --match-head-commit" };
  }
  if (endpoint !== "graphql") return null;
  try {
    return graphqlMerges(base) ? { ...base, kind: "graphql", ref: null } : null;
  } catch (error) {
    return { kind: "unsupported", why: String(error.message) };
  }
}

// Commands whose arguments are only ever data (`grep 'gh pr merge' docs`).
const DATA_COMMANDS = new Set(["echo", "printf", "grep", "egrep", "fgrep", "rg", "ag", "cat", "head", "tail", "less", "wc", "sort", "uniq", "jq", "true", ":"]);
function dataCommand(tokens) {
  const name = basename(tokens[0] || "");
  if (DATA_COMMANDS.has(name)) return true;
  if (name !== "git") return false;
  const sub = tokens.slice(1).find((token) => !token.startsWith("-"));
  return ["commit", "log", "grep", "show", "tag", "notes", "diff", "status"].includes(sub) &&
    !tokens.some((token) => token === "-c" || token.startsWith("--config-env"));
}

// git's subcommand after its global options, with `-C DIR` applied and the
// repository selection (`--git-dir`, `--work-tree`, inline GIT_DIR and
// GIT_WORK_TREE) kept for the push guard's own git queries. `repo.explicit`
// means the command names its repository; `repo.unknown` that it names one
// this hook cannot resolve literally.
const GIT_VALUE_OPTIONS = new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]);
const NON_LITERAL_PATH = /[$`~*?[\]]/;
function gitInvocation(tokens, cwd, env = {}) {
  let at = cwd;
  let cwdUnknown = false;
  const repo = { explicit: false, unknown: false, configOverride: false };
  const selected = { "--git-dir": env.GIT_DIR, "--work-tree": env.GIT_WORK_TREE };
  const finish = (sub, args) => {
    repo.args = [];
    for (const [flag, value] of Object.entries(selected)) {
      if (value === undefined) continue;
      repo.explicit = true;
      if (!value || NON_LITERAL_PATH.test(value)) repo.unknown = true;
      else repo.args.push(flag, path.resolve(at || process.cwd(), value));
    }
    return { sub, args, cwd: at, cwdUnknown, repo };
  };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("-")) return finish(token, tokens.slice(index + 1));
    const cut = token.startsWith("--") ? token.indexOf("=") : -1;
    const name = cut > 0 ? token.slice(0, cut) : token;
    if (!GIT_VALUE_OPTIONS.has(name)) continue;
    const value = cut > 0 ? token.slice(cut + 1) : (tokens[index + 1] ?? "");
    if (cut < 0) index += 1;
    if (name === "-C") {
      repo.explicit = true;
      if (NON_LITERAL_PATH.test(value)) cwdUnknown = true;
      else at = path.resolve(at || process.cwd(), value);
    } else if (name === "--git-dir" || name === "--work-tree") selected[name] = value;
    else if (name === "-c" || name === "--config-env") repo.configOverride = true;
  }
  return finish(null, []);
}

// `find … -exec CMD {} ;` (and -execdir/-ok/-okdir) runs CMD per match.
function findExecCommands(tokens) {
  const commands = [];
  for (let index = 1; index < tokens.length; index += 1) {
    if (!/^-(?:exec|execdir|ok|okdir)$/.test(tokens[index])) continue;
    const end = tokens.findIndex((token, at) => at > index && (token === ";" || token === "+"));
    commands.push(tokens.slice(index + 1, end < 0 ? tokens.length : end));
    if (end > 0) index = end;
  }
  return commands;
}

// Names this script redefines as a shell function or alias (`gh() {…}`,
// `function git {…}`, `alias gh=…`): a later `gh pr merge` then runs that
// definition, not the CLI this hook verifies.
function shadowedCommands(text) {
  const source = String(text).replace(/['"\\]/g, "");
  const names = new Set();
  const patterns = [
    /(?:^|[\s;&|({])(?:function\s+)?(gh|git)\s*\(\s*\)/g,
    /(?:^|[\s;&|({])function\s+(gh|git)(?![\w.-])/g,
    /(?:^|[\s;&|({])alias\s+(?:-\S+\s+)*(gh|git)=/g,
  ];
  for (const pattern of patterns) for (const match of source.matchAll(pattern)) names.add(match[1]);
  return names;
}

// A command that only sets or unsets variables for the rest of the script:
// `NAME=value` alone, `export`/`declare -x`/`typeset -x` with assignments,
// or `unset NAME`. null for anything else.
function shellAssignments(bare, prefix) {
  const set = new Map();
  const unset = [];
  if (bare.length && !prefix.tokens?.length && prefix.script === undefined) {
    for (const word of bare) {
      const match = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
      if (!match) return null;
      set.set(match[1], match[2]);
    }
    return { set, unset };
  }
  const head = bare[0];
  if (head === "unset") {
    for (const word of bare.slice(1)) if (!word.startsWith("-")) unset.push(word);
    return { set, unset };
  }
  if (head !== "export" && !((head === "declare" || head === "typeset") && bare.includes("-x"))) return null;
  for (const word of bare.slice(1)) {
    if (word === "-n") return { set: new Map(), unset: [] }; // un-exporting: leave as is
    const match = word.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
    if (match) set.set(match[1], match[2]);
  }
  return { set, unset };
}

// Compound commands whose body may run conditionally, repeatedly, or never.
// A newline-separated body tokenizes into its own segments, so a `cd` there
// has no control word in front of it; the open-block depth marks it instead.
const BLOCK_OPENERS = new Set(["if", "while", "until", "for", "select", "case", "{"]);
const BLOCK_CLOSERS = new Set(["fi", "done", "esac", "}"]);
function blockDepthAfter(segment, depth) {
  for (const word of segment) {
    if (!CONTROL_WORDS.has(word)) break;
    if (BLOCK_OPENERS.has(word)) depth += 1;
    else if (BLOCK_CLOSERS.has(word)) depth = Math.max(0, depth - 1);
  }
  return depth;
}

// Strip leading control words and the `command`/`builtin` builtins, which
// run a `cd` in this shell exactly like a bare one.
function directWords(segment) {
  let words = segment;
  for (;;) {
    if (CONTROL_WORDS.has(words[0])) words = words.slice(1);
    else if (words[0] === "command" || words[0] === "builtin") {
      words = words.slice(1);
      while (words[0] === "-p" || words[0] === "--") words = words.slice(1);
    } else return words;
  }
}

// Every merge in this script, plus refusals for what cannot be attributed.
//
// The rule is fail-closed. After line continuations are joined, every merge
// phrase in the raw text (`pr … merge`, `pulls/…/merge`, `mergePullRequest`,
// or a gh alias that expands to one) must belong to a piece this parser read
// whole: a directly executed gh command, the arguments of a data-only command
// (grep, echo, a `git commit` message…) that is not piped into anything but a
// plain filter, or an inert heredoc body. A phrase anywhere else — a shell
// `-c` string, `eval`, a here-string or heredoc fed to a shell, a pipe into a
// shell, `ssh`, `trap`, an unknown wrapper, a script file run later, or text
// the parser cannot delimit — refuses the merge.
//
// `git … push` phrases are counted the same way. Any the parser cannot
// attribute to a directly executed `git push` (or to data) become one
// `push-unresolved` entry, which the opt-in push guard refuses when enabled.
function mergeCommands(script, baseCwd) {
  const found = [];
  const aliasNames = mergeAliasNames();
  const count = (text) => mergePhraseCount(text, aliasNames);
  const joined = script.replace(/\\\r?\n/g, "");
  const raw = count(joined);
  const { text, bodies, unsure } = stripHeredocs(joined);
  const queue = tokenizeSegments(text);
  // A script that runs a file or stdin through a shell can execute anything it
  // wrote, so none of its data counts as inert.
  const runsFile = queue.some((segment) => runsScript(commandPrefix(segment, baseCwd).tokens || []));
  const inertBodies = runsFile ? [] : bodies.filter((body) => body.inert);
  let attributed = inertBodies.reduce((total, body) => total + count(body.text), 0);
  const rawPushes = pushPhraseCount(joined);
  let pushesAttributed = inertBodies.reduce((total, body) => total + pushPhraseCount(body.text), 0);
  let pushSite = null; // where the first unattributed push phrase was seen
  let guardEnv = {}; // an inline RAILYARD_GUARD_DEFAULT_BRANCH_PUSH on any command
  const unattributed = new Set();
  const shadowed = shadowedCommands(text);
  if ((shadowed.has("gh") && raw) || (shadowed.has("git") && rawPushes)) {
    // Nothing after the definition is what it appears to be.
    return [
      ...(shadowed.has("gh") && raw ? [{ kind: "unsupported", why: "this command redefines gh as a shell function or alias, so its merge cannot be checked; run the merge as its own command" }] : []),
      ...(shadowed.has("git") && rawPushes ? [{ kind: "push-unresolved", cwd: baseCwd || undefined, cwdUnknown: false, env: {} }] : []),
    ];
  }
  // `cd ../other && gh pr merge 7` resolves PR 7 in ../other, so the gate's own
  // lookup has to run there too — otherwise a settled PR 7 here authorizes an
  // unsettled PR 7 there. Tracked across segments, not interpreted deeply: an
  // unresolvable path just makes gh fail, which the gate refuses as unknown.
  let cwd = baseCwd || undefined;
  const cwdStack = [];
  let conditional = false; // the previous separator was && or ||
  let pipeline = false; // the previous separator was a single |
  let blockDepth = 0; // open if/while/until/for/select/case/{ blocks
  let cwdUnknown = false;
  // `export GH_REPO=o/r; gh pr merge 7` runs the merge in o/r: literal
  // assignments and exports carry to later commands, as `cd` does. One made
  // where it may not run (behind &&/||, in a block) has an unknown value.
  let shellEnv = {};
  let shellUnset = [];
  for (let i = 0; i < queue.length && i < SEGMENT_CAP; i += 1) {
    const segment = queue[i];
    if (segment.length === 1 && (segment[0] === "&&" || segment[0] === "||")) {
      conditional = true;
      continue;
    }
    if (segment.length === 1 && segment[0] === "|") {
      pipeline = true; // stages run in subshells
      continue;
    }
    if (segment.length === 1 && segment[0] === "&") continue; // handled by look-ahead
    if (segment.length === 1 && (segment[0] === "(" || segment[0] === ")")) {
      // Bash restores the directory and variables when a subshell closes.
      if (segment[0] === "(") cwdStack.push({ cwd, cwdUnknown, shellEnv, shellUnset });
      else if (cwdStack.length) ({ cwd, cwdUnknown, shellEnv, shellUnset } = cwdStack.pop());
      continue;
    }
    blockDepth = blockDepthAfter(segment, blockDepth);
    const prefix = commandPrefix(segment, cwd, { cwdUnknown, env: shellEnv, unset: shellUnset });
    const next = queue[i + 1];
    // A pipeline stage or a backgrounded command (`cd /x &`) runs in a
    // subshell; the marker follows the command it ends, so look ahead.
    const piped = pipeline || (next && next.length === 1 && (next[0] === "|" || next[0] === "&"));
    const bare = directWords(segment);
    const head = prefix.tokens?.[0];
    const assigned = shellAssignments(bare, prefix);
    if (assigned) {
      if (!piped) {
        const unknown = conditional || blockDepth > 0 || bare.length !== segment.length;
        shellEnv = { ...shellEnv };
        for (const [name, value] of assigned.set) {
          shellEnv[name] = unknown ? "$unknown" : value;
          shellUnset = shellUnset.filter((item) => item !== name);
        }
        for (const name of assigned.unset) {
          if (unknown) shellEnv[name] = "$unknown";
          else {
            delete shellEnv[name];
            if (!shellUnset.includes(name)) shellUnset = [...shellUnset, name];
          }
        }
      }
      conditional = false;
      pipeline = false;
      continue;
    }
    if (bare[0] === "cd" || bare[0] === "pushd" || bare[0] === "popd") {
      // A `cd` in a pipeline stage runs in a subshell and is discarded; the `|`
      // marker follows the stage it ends, so `piped` looks ahead as well.
      // Behind `&&`/`||`, a control word, or inside an open compound block
      // (`if …\ncd x\nfi`) the branch cannot be evaluated, and
      // a bare `cd` (HOME), `cd -`, `cd ~…`, an option, an expansion, a glob or
      // pushd/popd lands somewhere this hook cannot name: all mark the
      // directory unknown rather than resolving it against the wrong place.
      const literal = bare[0] === "cd" && bare[1] && !/^[-~]|[$`*?[\]{}]/.test(bare[1]);
      const guarded = bare.length !== segment.length && CONTROL_WORDS.has(segment[0]);
      if (!piped) {
        if (!literal || guarded || conditional || blockDepth > 0) cwdUnknown = true;
        else cwd = path.resolve(cwd || process.cwd(), bare[1]);
      }
      conditional = false;
      pipeline = false;
      continue;
    }
    // A wrapped `cd` (`env cd`, `timeout 5 cd`) or anything run in this shell
    // from elsewhere (`source`, `.`, `eval`) may move it somewhere unknown.
    if (!piped && (head === "cd" || head === "pushd" || head === "popd" || bare[0] === "source" ||
        bare[0] === "." || bare[0] === "eval")) {
      cwdUnknown = true;
    }
    conditional = false;
    pipeline = false;
    const pieceCount = count(segment.join(" "));
    const pushPiece = pushPhraseCount(segment.join(" "));
    const site = { cwd: prefix.cwd, cwdUnknown: prefix.cwdUnknown, env: prefix.env };
    if (Object.hasOwn(prefix.env, "RAILYARD_GUARD_DEFAULT_BRANCH_PUSH")) {
      guardEnv = { RAILYARD_GUARD_DEFAULT_BRANCH_PUSH: prefix.env.RAILYARD_GUARD_DEFAULT_BRANCH_PUSH };
    }
    if (prefix.script !== undefined) {
      if (pieceCount || count(prefix.script)) {
        unattributed.add("a merge inside a string a shell or eval interprets cannot be checked; run the merge as its own command");
      }
      if (pushPiece || pushPhraseCount(prefix.script)) pushSite ??= site;
      continue;
    }
    if (!head) continue;
    if (basename(head) === "find") {
      for (const group of findExecCommands(prefix.tokens)) {
        const inner = commandPrefix(group, prefix.cwd, prefix);
        if (inner.script === undefined && basename(inner.tokens?.[0] || "") === "gh") {
          const merge = mergeFromPrefix(inner);
          if (merge) found.push(merge);
          attributed += count(group.join(" "));
        }
      }
      continue;
    }
    if (basename(head) === "gh" && prefix.appendsArgs && pieceCount) {
      // xargs appends a PR, repository or flags read from stdin after the
      // gate has read the visible arguments.
      unattributed.add("xargs adds merge arguments this guard cannot see; run the merge as its own command");
      pushesAttributed += pushPiece;
      continue;
    }
    if (basename(head) === "gh") {
      const merge = mergeFromPrefix(prefix);
      if (merge) found.push(merge);
      attributed += pieceCount;
      pushesAttributed += pushPiece; // gh never runs its arguments as git
      continue;
    }
    let pushData = false;
    if (basename(head) === "git") {
      const invocation = gitInvocation(prefix.tokens.slice(1), prefix.cwd, prefix.env);
      if (invocation.sub === "push") {
        found.push({
          kind: "push", tokens: invocation.args, env: prefix.env, cwd: invocation.cwd,
          cwdUnknown: prefix.cwdUnknown || invocation.cwdUnknown, repo: invocation.repo,
          // `xargs git push origin` appends refspecs this hook never sees.
          appended: prefix.appendsArgs,
        });
        pushesAttributed += pushPiece;
        continue; // its arguments are refspecs, never data
      } else {
        // Other git commands never run their own arguments as a push (a
        // branch or message that merely says push), except these, which run
        // commands, and `-c`, which can define an alias.
        pushData = !["rebase", "bisect", "submodule"].includes(invocation.sub) && !invocation.repo.configOverride;
      }
    }
    if (!pieceCount && !pushPiece) continue;
    // Data is inert only when nothing downstream in its pipeline runs it.
    let downstream = true;
    for (let j = i + 1; queue[j]?.length === 1 && queue[j][0] === "|"; j += 2) {
      const consumer = commandPrefix(queue[j + 1] || [], cwd);
      if (consumer.script !== undefined || !SAFE_FILTERS.has(basename(consumer.tokens?.[0] || ""))) downstream = false;
    }
    const data = !runsFile && downstream && dataCommand(prefix.tokens);
    if (data) attributed += pieceCount;
    if (data || (!runsFile && downstream && pushData)) pushesAttributed += pushPiece;
    else if (pushPiece) pushSite ??= site;
  }
  if ((unsure && rawPushes) || rawPushes > pushesAttributed) {
    const at = pushSite ?? { cwd: baseCwd || undefined, cwdUnknown: false, env: {} };
    found.push({ kind: "push-unresolved", ...at, env: { ...guardEnv, ...at.env } });
  }
  if (unsure && raw) unattributed.add("a heredoc in this command cannot be delimited exactly, so a merge in it cannot be checked");
  if (raw > attributed && !unattributed.size) {
    unattributed.add("this command mentions a merge this guard cannot attribute to one directly executed gh command (for example inside a heredoc, pipe, wrapper or interpreted string); run the merge as its own command");
  }
  for (const why of unattributed) found.push({ kind: "unsupported", why });
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
    throw new Error("an unresolved or conditional `cd` makes the merge's repository unknown; run the merge as its own command in an explicit workdir");
  }
  // GH_REPO/GH_HOST from an expansion, or from an assignment that may not have
  // run, pick a repository or host this guard cannot name.
  if (["GH_REPO", "GH_HOST", "GH_CONFIG_DIR"].some((name) => /[$`]/.test(command.env?.[name] ?? ""))) {
    throw new Error("GH_REPO, GH_HOST or GH_CONFIG_DIR is computed or conditionally set, so the merge's repository is unknown; set it literally on the merge");
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

function recordOverride(entry) {
  const runLog = require("./run-log");
  return runLog.append({ ...entry, session_id: runLog.clip(entry.session_id), tool: runLog.clip(entry.tool) });
}

// Opt-in guard for `git push` to a repository's default branch. Off unless
// RAILYARD_GUARD_DEFAULT_BRANCH_PUSH=1 (inline or in the environment) or the
// repository sets `git config railyard.guardDefaultBranchPush true`.
//
// Like the merge gate it fails closed instead of modelling git: once enabled,
// a push refuses unless its destination provably is not the default branch.
function git(args, cwd) {
  return execFileSync("git", args, {
    encoding: "utf8", cwd, timeout: Math.max(1, Math.min(1500, DEADLINE - Date.now())),
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

// The push's repository: `known` only when the selection is literal and git
// resolves it. The guard's own queries carry the same `--git-dir`/`--work-tree`.
function pushRepository(command) {
  const repo = command.repo || { explicit: false, unknown: false, args: [] };
  if (repo.unknown || command.cwdUnknown) return { ...repo, known: false };
  try {
    git([...repo.args, "rev-parse", "--git-dir"], command.cwd);
    return { ...repo, known: true };
  } catch {
    return { ...repo, known: false };
  }
}

function pushGuardEnabled(command, repo) {
  if (commandSetting({ env: command.env, unset: [], ignoreEnv: false }, "RAILYARD_GUARD_DEFAULT_BRANCH_PUSH") === "1") return true;
  // A repository the command names but this hook cannot read may have opted
  // in; with no named repository, a failed lookup is simply not opted in.
  if (!repo.known && repo.explicit) return true;
  try {
    return git([...repo.args, "config", "--type=bool", "--get", "railyard.guardDefaultBranchPush"], command.cwd) === "true";
  } catch (error) {
    return error?.status !== 1 && repo.known; // 1: unset; anything else fails closed
  }
}

// The push-relevant config: push.default, remote.pushDefault, remote.<r>.push
// and each branch's remote, pushRemote and upstream.
function pushConfig(command, repo) {
  const config = new Map();
  let text = "";
  try {
    text = git([...repo.args, "config", "--get-regexp",
      "^(push\\.default|remote\\.pushdefault|remote\\..+\\.push|branch\\..+\\.(merge|remote|pushremote))$"], command.cwd);
  } catch (error) {
    if (error?.status !== 1) throw error; // 1: none set
  }
  for (const line of text.split("\n").filter(Boolean)) {
    const cut = line.indexOf(" ");
    const key = cut < 0 ? line : line.slice(0, cut);
    if (!config.has(key)) config.set(key, cut < 0 ? "" : line.slice(cut + 1));
  }
  return config;
}

// `--signed` is a boolean with an optional `=mode`, never a separate value.
const PUSH_VALUE_FLAGS = new Set(["-o", "--push-option", "--repo", "--receive-pack", "--exec"]);
// Why this push may reach the default branch, or null when it provably does not.
function defaultBranchPush(command, repo) {
  const words = [];
  const flags = new Map();
  const args = command.tokens;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--") { words.push(...args.slice(index + 1)); break; }
    if (!token.startsWith("-")) words.push(token);
    else {
      const cut = token.indexOf("=");
      const name = cut > 0 ? token.slice(0, cut) : token;
      let value = cut > 0 ? token.slice(cut + 1) : true;
      if (cut < 0 && PUSH_VALUE_FLAGS.has(token)) { value = args[index + 1]; index += 1; }
      flags.set(name, value);
    }
  }
  if (flags.has("-n") || flags.has("--dry-run")) return null;
  if (command.cwdUnknown || !repo.known) return "the push's repository is unknown";
  if (command.appended) return "xargs may append refspecs this guard cannot see";
  if (repo.configOverride) return "`git -c` may change where it pushes";
  if (flags.has("--all") || flags.has("--mirror") || flags.has("--branches")) return "--all/--mirror pushes every branch";
  let config;
  try { config = pushConfig(command, repo); } catch { return "its push configuration is unreadable"; }
  let current = null;
  const currentBranch = () => {
    try { current ??= git([...repo.args, "symbolic-ref", "--short", "HEAD"], command.cwd); } catch { current = ""; }
    return current;
  };
  const explicitRemote = typeof flags.get("--repo") === "string" ? flags.get("--repo") : words[0];
  const remote = explicitRemote || config.get(`branch.${currentBranch()}.pushremote`) ||
    config.get("remote.pushdefault") || config.get(`branch.${currentBranch()}.remote`) || "origin";
  // The remote's default branch as this clone records it. Without that record
  // (a URL, or no refs/remotes/<remote>/HEAD) the guard cannot name the branch
  // to protect, so it refuses rather than guessing. It does not go to the
  // network; `git remote set-head <remote> --auto` refreshes a stale record.
  let branch;
  try {
    branch = git([...repo.args, "symbolic-ref", "--short", `refs/remotes/${remote}/HEAD`], command.cwd).replace(`${remote}/`, "");
  } catch {
    return `the default branch of ${remote} is unknown here; run \`git remote set-head ${remote} --auto\``;
  }
  const defaults = [branch];
  const isDefault = (target) => defaults.includes(String(target).replace(/^refs\/heads\//, ""));
  const remotePush = config.has(`remote.${remote}.push`);
  const refspecs = words.slice(explicitRemote === words[0] ? 1 : 0);
  if (!refspecs.length) {
    // No refspec: remote.<r>.push, then push.default (simple unless set) decide.
    if (remotePush) return `remote.${remote}.push decides where it pushes`;
    const mode = (config.get("push.default") || "simple").toLowerCase();
    if (mode === "nothing") return null;
    if (mode === "matching") return "push.default=matching pushes every matching branch";
    const branchName = currentBranch();
    if (!branchName) return "it has no explicit refspec on a detached HEAD";
    if (isDefault(branchName)) return `it pushes the current branch ${branchName}`;
    const upstream = config.get(`branch.${branchName}.merge`);
    if ((mode === "upstream" || mode === "tracking") && upstream && isDefault(upstream)) {
      return `push.default=${mode} pushes ${branchName} to its upstream ${upstream}`;
    }
    return null;
  }
  for (const refspec of refspecs) {
    const spec = refspec.replace(/^\+/, "");
    if (spec === ":") return `the matching refspec ${refspec} pushes every matching branch`;
    const colon = spec.lastIndexOf(":");
    // Without `:dst`, remote.<r>.push maps the source to its destination.
    if (colon < 0 && remotePush) return `remote.${remote}.push decides where ${refspec} goes`;
    let target = colon >= 0 ? spec.slice(colon + 1) : spec;
    if (target === "HEAD" || (colon < 0 && spec === "HEAD")) target = currentBranch();
    if (/[$`*?[\]]/.test(target)) return `the refspec ${refspec} is not literal`;
    if (isDefault(target)) return `it updates ${target}`;
  }
  return null;
}

function handlePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  const args = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const script = commandScript(args);
  if (!script) return;
  const requestedCwd = [args.working_directory, args.workdir, args.cwd, input.cwd]
    .find((value) => typeof value === "string" && value);
  let found = null;
  let overrideNote = "";
  // Everything, parsing and the override included, runs inside this try: an
  // exception refuses the merge instead of crashing the hook open.
  try {
    found = mergeCommands(script, requestedCwd);
    for (const push of found.filter((command) => command.kind === "push" || command.kind === "push-unresolved")) {
      const repo = pushRepository(push);
      if (!pushGuardEnabled(push, repo)) continue;
      const why = push.kind === "push-unresolved"
        ? "a `git push` inside a script, heredoc, pipe or wrapper cannot be checked; run the push as its own command"
        : defaultBranchPush(push, repo);
      if (why) {
        process.stderr.write(`[railyard] Push refused: this repository guards its default branch and ${why}; push a branch and open a PR instead.\n`);
        process.exitCode = 2;
        return;
      }
    }
    const commands = found.filter((command) => command.kind !== "push" && command.kind !== "push-unresolved");
    if (!commands.length) return;
    const override = evaluateOverride({
      script, commands, input, defaultCwd: requestedCwd, record: recordOverride,
    });
    if (override?.file) {
      process.stderr.write(`[railyard] Merge allowed by the user-directed override without CE settlement; recorded in ${override.file}.\n`);
      return;
    }
    if (override) overrideNote = ` The user-directed override did not apply: ${override.reason}.`;
    const blocked = commands.find((command) => command.kind === "unsupported");
    if (blocked) throw new Error(blocked.why);
    if (commands.length !== 1) throw new Error("merge one PR per command with that PR's CE snapshot");
    verifyMerge(commands[0]);
  } catch (error) {
    // A parser failure on text that never mentions a merge is not a merge.
    if (!found && !/merge|push/i.test(script)) return;
    const why = String(error?.message || error).split("\n")[0];
    process.stderr.write("[railyard] Merge refused: " + why +
      ". Have ce-babysit-pr complete readiness and save its final snapshot stdout beside state.json; then retry the pinned merge." +
      overrideNote + "\n");
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
