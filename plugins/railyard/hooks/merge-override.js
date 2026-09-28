// The user-directed merge override for merge-settlement-gate.js.
//
// A user who explicitly directs a merge (including an admin bypass of branch
// protection) can skip CE settlement for that one merge. The override is an
// inline assignment in the command text, never ambient process env, so it
// cannot linger as a blanket bypass and stays visible in the command the user
// approved.
//
// It is an ALLOW-LIST of one command shape, read from the raw text with its own
// strict tokenizer. Anything else — any other segment, operator, expansion,
// wrapper, quote trick or flag — refuses the override and falls back to the CE
// gate:
//
//   [cd /ABSOLUTE/LITERAL/DIR &&] NAME=VALUE... gh pr merge REF [FLAGS]
//   [cd /ABSOLUTE/LITERAL/DIR &&] NAME=VALUE... gh api -X PUT repos/OWNER/REPO/pulls/N/merge [FLAGS]
//
// where the assignments are RAILYARD_MERGE_OVERRIDE=user-approved (required)
// and optionally the RAILYARD_CE_* settings, and every structural word is an
// unquoted literal from a strict charset. Quoting is allowed only for the text
// of a commit subject/body/message.
//
// A used override appends one JSON line to the Railyard run log; when that
// line cannot be written, the override does not apply. The override is still
// honor-system: the run-log line is a trace, not proof of the user's words.
const { statSync } = require("fs");
const path = require("path");

const OVERRIDE_NAME = "RAILYARD_MERGE_OVERRIDE";
const OVERRIDE_VALUE = "user-approved";
const ASSIGNABLE = new Set([OVERRIDE_NAME, "RAILYARD_CE_SNAPSHOT", "RAILYARD_CE_MODE"]);

const NAME = /^[A-Za-z0-9._-]+$/;
const WORD = /^[A-Za-z0-9._\/:=@+,%-]+$/;
const ABSOLUTE_DIR = /^\/[A-Za-z0-9._\/-]*$/;
const GH = /^(?:gh|\/[A-Za-z0-9._\/-]+\/gh)$/;
const NUMBER = /^[1-9][0-9]*$/;
const SHA = /^[0-9a-f]{40}$/i;
const EMAIL = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$/;

// Split into words. A word is either wholly unquoted from WORD's charset, or
// one wholly single-quoted string, or one wholly double-quoted string with no
// `$`, backtick, backslash or `!`. `&&` is its own word. Anything else
// (operators, expansions, globs, braces, comments, escapes, concatenated
// quotes, newlines inside the command) returns null.
function literalWords(text) {
  const words = [];
  const source = text.trim();
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (char === " " || char === "\t") { index += 1; continue; }
    let end;
    let word;
    if (char === "'" || char === '"') {
      end = source.indexOf(char, index + 1);
      if (end < 0) return null;
      const body = source.slice(index + 1, end);
      if (char === '"' && /[$`\\!]/.test(body)) return null;
      word = { text: body, quoted: true };
      end += 1;
    } else if (source.startsWith("&&", index)) {
      word = { text: "&&", quoted: false };
      end = index + 2;
    } else {
      end = index;
      while (end < source.length && !/[\s'"&]/.test(source[end])) end += 1;
      word = { text: source.slice(index, end), quoted: false };
      if (!WORD.test(word.text)) return null;
    }
    // Quotes glued to another word (`pr'merge'`) are not a literal shape.
    if (end < source.length && !/[ \t]/.test(source[end])) return null;
    words.push(word);
    index = end;
  }
  return words;
}

const unquoted = (word) => word && !word.quoted ? word.text : null;

function literalRepo(value) {
  const parts = String(value).split("/");
  return parts.length === 2 && parts.every((part) => NAME.test(part) && !/^\.+$/.test(part));
}

function literalRef(value) {
  if (NUMBER.test(value)) return true;
  const url = value.match(/^https:\/\/([A-Za-z0-9.-]+)\/([^/]+)\/([^/]+)\/pull\/([1-9][0-9]*)$/);
  if (url) return literalRepo(`${url[2]}/${url[3]}`);
  // A branch: literal segments, not an option, no `..`.
  return /^[A-Za-z0-9][A-Za-z0-9._\/-]*$/.test(value) && !value.includes("..") &&
    value.split("/").every((part) => NAME.test(part));
}

// Options each command may carry, and how their values must look. `text`
// values may be quoted; every other value must be an unquoted literal.
const PR_FLAGS = new Map([
  ["--squash", null], ["-s", null], ["--merge", null], ["-m", null], ["--rebase", null], ["-r", null],
  ["--admin", null], ["--delete-branch", null], ["-d", null],
  ["--repo", literalRepo], ["-R", literalRepo],
  ["--subject", "text"], ["-t", "text"], ["--body", "text"], ["-b", "text"],
  ["--match-head-commit", (v) => SHA.test(v)], ["--author-email", (v) => EMAIL.test(v)], ["-A", (v) => EMAIL.test(v)],
]);
const REST_FIELDS = new Map([
  ["sha", (v) => SHA.test(v)],
  ["merge_method", (v) => ["merge", "squash", "rebase"].includes(v)],
  ["commit_title", "text"],
  ["commit_message", "text"],
]);

function valueOk(check, word) {
  if (!word) return false;
  if (check === "text") return true;
  return !word.quoted && check(word.text);
}

// `gh pr merge` arguments after `merge`.
function prShape(words) {
  let ref = null;
  const flags = {};
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const text = unquoted(word);
    if (text === null) return null;
    if (!text.startsWith("-")) {
      if (ref !== null || !literalRef(text)) return null;
      ref = text;
      continue;
    }
    const eq = text.indexOf("=");
    const name = eq > 0 ? text.slice(0, eq) : text;
    if (!PR_FLAGS.has(name) || Object.hasOwn(flags, name)) return null;
    const check = PR_FLAGS.get(name);
    if (check === null) {
      if (eq > 0) return null;
      flags[name] = true;
      continue;
    }
    const value = eq > 0 ? { text: text.slice(eq + 1), quoted: false } : words[++index];
    if (!valueOk(check, value)) return null;
    flags[name] = value.text;
  }
  if (ref === null) return null;
  return { kind: "pr", target: ref, repo: flags["--repo"] ?? flags["-R"] ?? null, admin: flags["--admin"] === true };
}

// `gh api` arguments after `api`.
function restShape(words) {
  let endpoint = null;
  let method = null;
  const fields = new Set();
  for (let index = 0; index < words.length; index += 1) {
    const text = unquoted(words[index]);
    if (text === null) return null;
    if (text === "-X" || text === "--method") {
      if (method !== null || unquoted(words[++index]) !== "PUT") return null;
      method = "PUT";
    } else if (text === "-f" || text === "--raw-field" || text === "-F" || text === "--field") {
      const field = words[++index];
      const eq = field ? field.text.indexOf("=") : -1;
      if (!field || eq <= 0) return null;
      const key = field.text.slice(0, eq);
      const check = REST_FIELDS.get(key);
      if (!check || fields.has(key)) return null;
      const value = { text: field.text.slice(eq + 1), quoted: field.quoted };
      // A typed field reads `@file`; a quoted key is not literal.
      if (/^@/.test(value.text) || (check !== "text" && !valueOk(check, value))) return null;
      if (field.quoted && check !== "text") return null;
      fields.add(key);
    } else if (!text.startsWith("-") && endpoint === null) {
      const route = text.match(/^\/?repos\/([^/]+)\/([^/]+)\/pulls\/([1-9][0-9]*)\/merge$/);
      if (!route || !literalRepo(`${route[1]}/${route[2]}`)) return null;
      endpoint = { text, repo: `${route[1]}/${route[2]}`, number: route[3] };
    } else {
      return null;
    }
  }
  if (!endpoint || method !== "PUT") return null;
  return { kind: "api", target: endpoint.text, repo: endpoint.repo, admin: false };
}

function isDirectory(dir) {
  try { return statSync(dir).isDirectory(); } catch { return false; }
}

// The accepted shape of `script`, or a refusal reason.
function overrideShape(script) {
  if (/[\r\n]/.test(script.trim())) return { reason: "the command must be a single line" };
  const words = literalWords(script);
  if (!words) return { reason: "the command uses shell syntax other than literal words" };
  let index = 0;
  let cwd = null;
  if (unquoted(words[0]) === "cd") {
    const dir = unquoted(words[1]);
    if (!dir || !ABSOLUTE_DIR.test(dir) || unquoted(words[2]) !== "&&") {
      return { reason: "only one literal `cd /absolute/dir &&` may precede the merge" };
    }
    if (!isDirectory(dir)) return { reason: "the working directory is unknown" };
    cwd = path.resolve(dir);
    index = 3;
  }
  const env = {};
  for (; index < words.length; index += 1) {
    const assignment = unquoted(words[index])?.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!assignment) break;
    if (!ASSIGNABLE.has(assignment[1]) || Object.hasOwn(env, assignment[1])) {
      return { reason: `only ${OVERRIDE_NAME} and the RAILYARD_CE_* settings may be assigned` };
    }
    env[assignment[1]] = assignment[2];
  }
  if (env[OVERRIDE_NAME] !== OVERRIDE_VALUE) {
    return {
      reason: Object.hasOwn(env, OVERRIDE_NAME)
        ? `its value must be ${OVERRIDE_VALUE}`
        : "it must be an inline assignment on the merge command itself",
    };
  }
  const [gh, group, verb] = words.slice(index, index + 3).map(unquoted);
  if (!gh || !GH.test(gh)) return { reason: "the merge must call gh directly" };
  const rest = words.slice(index + (group === "pr" ? 3 : 2));
  if (words.slice(index).some((word) => !word.quoted && word.text === "&&")) {
    return { reason: "the command holds more than one command" };
  }
  if (rest.some((word) => !word.quoted && word.text === "--auto")) {
    return { reason: "--auto could merge a later, unapproved head" };
  }
  const shape = group === "pr" && verb === "merge" ? prShape(rest) : group === "api" ? restShape(rest) : null;
  if (!shape) {
    return { reason: "only `gh pr merge <literal PR>` or a literal REST merge with plain flags qualifies" };
  }
  return { shape: { ...shape, cwd } };
}

// Decide the override for `script`, whose merges the gate parsed as
// `commands`. Returns null when no override was attempted, { reason } when it
// does not apply, and { file } once a used override has been recorded.
function evaluateOverride({ script, commands, input, defaultCwd, record }) {
  if (!script.includes(OVERRIDE_NAME)) return null;
  const { shape, reason } = overrideShape(script);
  if (!shape) return { reason };
  // The gate's own parser must agree there is exactly this one merge, with
  // the same target and repository, so the two parsers cannot drift apart.
  const [merge] = commands;
  const parsedTarget = merge?.kind === "api" ? merge.endpoint?.[0] : merge?.ref;
  const parsedRepo = merge?.kind === "api" ? shape.repo : merge?.flags?.get("--repo") ?? merge?.flags?.get("-R") ?? null;
  if (commands.length !== 1 || merge.kind !== shape.kind || parsedTarget !== shape.target || parsedRepo !== shape.repo) {
    return { reason: "the command holds more than one merge, or one the guard cannot read" };
  }
  try {
    const file = record({
      event: "merge-override",
      session_id: input.session_id,
      tool: input.tool_name,
      cwd: shape.cwd || defaultCwd || process.cwd(),
      kind: shape.kind,
      target: shape.target,
      repo: shape.repo,
      admin: shape.admin,
    });
    return { file };
  } catch {
    return { reason: "its record could not be written to the Railyard run log" };
  }
}

module.exports = { evaluateOverride, overrideShape };
