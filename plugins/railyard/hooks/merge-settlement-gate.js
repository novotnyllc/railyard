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
  CONTROL_WORDS, basename, commandPrefix, commandScript, parseArgs, stripHeredocs, tokenizeSegments,
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

// Parser bounds: a pathological nest cannot spin the hook inside its budget,
// but a merge past either bound refuses instead of being silently skipped.
const SEGMENT_CAP = 512;
const DEPTH_CAP = 8;
const mentionsMerge = (value) => /merge/i.test(Array.isArray(value) ? value.join(" ") : String(value));
const BEYOND_CAP = "the command is too long or nested too deeply to check every merge in it; run the merge as its own command";

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

// One simple command's merge, if it is one. `--help` is not a merge.
function mergeFromPrefix(prefix) {
  const head = prefix.tokens?.[0];
  if (!head) return null;
  if (basename(head) !== "gh") {
    // `$(which gh) pr merge 7` leaves a bare `pr merge` segment, and a globbed
    // `g[h]` still runs gh.
    const t = prefix.tokens;
    const computed = (/[$`*?[\]]/.test(basename(head)) && (t[1] === "pr" || t[1] === "api")) ||
      (t[0] === "pr" && t[1] === "merge");
    return computed && mentionsMerge(t)
      ? { kind: "unsupported", why: "gh is invoked through a computed or unrecognized command; run gh pr merge directly" }
      : null;
  }
  const { env, unset, ignoreEnv } = prefix;
  const tokens = prefix.tokens.slice(1);
  const { words, flags } = parseArgs(tokens);
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

// EVERY merge command in this text. A shell runs them all, so checking only
// the first lets `gh pr merge 5 && gh pr merge 8` merge PR 8 unverified the
// moment PR 5 is settled.
// `bash -lc "gh pr merge 7"` carries its whole script as one quoted token, so
// the wrapper's payload has to be parsed as command text in its own right.
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
  if (queue.length > SEGMENT_CAP && queue.slice(SEGMENT_CAP).some(mentionsMerge)) {
    found.push({ kind: "unsupported", why: BEYOND_CAP });
  }
  for (let i = 0; i < queue.length && i < SEGMENT_CAP; i += 1) {
    const segment = queue[i];
    const prefix = commandPrefix(segment, cwd, { ...inherited, cwdUnknown });
    const piped = pipeline || (queue[i + 1] && queue[i + 1].length === 1 && queue[i + 1][0] === "|");
    if (prefix.script !== undefined) {
      if (depth < DEPTH_CAP) found.push(...mergeCommands(prefix.script, prefix.cwd, prefix, depth + 1));
      else if (mentionsMerge(prefix.script)) found.push({ kind: "unsupported", why: BEYOND_CAP });
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
      if (segment[0] === "(") cwdStack.push({ cwd, cwdUnknown });
      else if (cwdStack.length) ({ cwd, cwdUnknown } = cwdStack.pop());
      continue;
    }
    // `if true; then cd ../other; fi` puts `cd` behind control words. Strip
    // them to see it, but treat it as conditional: the branch is not knowable.
    const bare = segment[0] !== "cd"
      ? segment.filter((t, idx) => !(CONTROL_WORDS.has(t) && segment.slice(0, idx).every((p) => CONTROL_WORDS.has(p))))
      : segment;
    if (bare[0] === "cd" || bare[0] === "pushd" || bare[0] === "popd") {
      // A `cd` in a pipeline stage runs in a subshell and is discarded; the `|`
      // marker follows the stage it ends, so `piped` looks ahead as well.
      // Behind `&&`/`||` or a control word the branch cannot be evaluated, and
      // a bare `cd` (HOME), `cd -`, `cd ~…`, an option, an expansion, a glob or
      // pushd/popd lands somewhere this hook cannot name: all mark the
      // directory unknown rather than resolving it against the wrong place.
      const literal = bare[0] === "cd" && bare[1] && !/^[-~]|[$`*?[\]{}]/.test(bare[1]);
      if (!piped) {
        if (!literal || bare !== segment || conditional) cwdUnknown = true;
        else cwd = path.resolve(cwd || process.cwd(), bare[1]);
      }
      conditional = false;
      pipeline = false;
      continue;
    }
    // A shell reading its script from a pipe (`echo 'gh pr merge 7' | bash`)
    // runs text this hook cannot see.
    if (prefix.shell && pipeline && !prefix.tokens.length && mentionsMerge(text)) {
      found.push({ kind: "unsupported", why: "a script piped into a shell cannot be checked; run the merge as its own command" });
    }
    conditional = false;
    pipeline = false;
    const tokens = prefix.tokens ?? [];
    const commands = basename(tokens[0] || "") === "find"
      ? findExecCommands(tokens).map((group) => commandPrefix(group, prefix.cwd, prefix))
      : [prefix];
    for (const command of commands) {
      const merge = mergeFromPrefix(command);
      if (merge) found.push(merge);
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
    throw new Error("an unresolved or conditional `cd` makes the merge's repository unknown; run the merge as its own command in an explicit workdir");
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

function handlePayload(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  if (input.hook_event_name && input.hook_event_name !== "PreToolUse") return;
  const args = input.tool_input && typeof input.tool_input === "object" ? input.tool_input : {};
  const script = commandScript(args);
  if (!script) return;
  const requestedCwd = [args.working_directory, args.workdir, args.cwd, input.cwd]
    .find((value) => typeof value === "string" && value);
  let commands = null;
  let overrideNote = "";
  // Everything, parsing and the override included, runs inside this try: an
  // exception refuses the merge instead of crashing the hook open.
  try {
    commands = mergeCommands(stripHeredocs(script), requestedCwd);
    if (!commands.length) return;
    const override = evaluateOverride({
      script, commands, input, defaultCwd: requestedCwd, record: recordOverride,
    });
    if (override?.file) {
      process.stderr.write(`[railyard] Merge allowed by the user-directed override without CE settlement; recorded in ${override.file}.\n`);
      return;
    }
    if (override) overrideNote = ` The user-directed override did not apply: ${override.reason}.`;
    if (commands.length !== 1) throw new Error("merge one PR per command with that PR's CE snapshot");
    verifyMerge(commands[0]);
  } catch (error) {
    // A parser failure on text that never mentions a merge is not a merge.
    if (!commands && !/merge/i.test(script)) return;
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
