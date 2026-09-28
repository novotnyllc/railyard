// Shell-command reading for merge-settlement-gate.js: harness argv shapes,
// heredocs, quote-aware segmentation, wrapper peeling and gh argument parsing.
// Pure text processing; it runs nothing.
const path = require("path");

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
// Control words and grouping punctuation a merge can legitimately sit behind:
// `(gh pr merge 7)`, `if gh pr merge 7; then ...`. Missing these means the
// segment looks unrelated and the merge runs with no gate and no notice.
const CONTROL_WORDS = new Set([
  "if", "then", "else", "elif", "fi", "do", "done", "while", "until", "for",
  "case", "esac", "in", "select", "function", "noglob", "nocorrect",
  // Bash runs `{ gh pr merge 7; }` as a command group. These are standalone
  // TOKENS, never split at the character level — `repos/{owner}/{repo}/…`
  // must stay one token.
  "{", "}",
]);
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
// The one list of shells. A shell given a script (`-c`, a here-string, a
// piped or redirected stdin, a file) runs text this guard does not attribute.
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "ksh", "mksh", "ash", "fish", "tcsh", "csh", "busybox"]);
// Shell options that take a separate value (`bash -o pipefail -c …`).
const SHELL_VALUE_OPTIONS = new Set(["-o", "+o", "-O", "+O", "--rcfile", "--init-file"]);

// Merge phrases, counted the same way in the raw text and in the parsed
// pieces the guard can attribute. Quotes and backslashes are dropped and
// `$IFS` reads as a space, so `gh pr 'merge'` or `pr${IFS}merge` still count.
function normalizeForPhrases(text) {
  return String(text).replace(/\\\r?\n/g, "").replace(/['"\\]/g, "").replace(/\$\{?IFS\}?/g, " ");
}
function mergePhraseCount(text, aliasNames = []) {
  const source = normalizeForPhrases(text);
  const patterns = [
    /\bpr\b(?:\s+-\S+(?:\s+[^\s-]\S*)?)*\s+merge\b/g,
    /pulls\/[^\s/]*\/merge\b/g,
    /mergePullRequest/g,
  ];
  if (aliasNames.length) {
    const names = aliasNames.map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
    patterns.push(new RegExp(`\\bgh\\s+(?:${names})(?=\\s|$)`, "g"));
  }
  return patterns.reduce((total, pattern) => total + (source.match(pattern) || []).length, 0);
}

// `git … push` phrases, counted the same way so the default-branch push guard
// can tell a push it parsed from one hidden in a script, heredoc or wrapper.
// `push` must be its own word: a `push-fix` branch is not a push.
function pushPhraseCount(text) {
  return (normalizeForPhrases(text).match(/(?<![\w.-])git\b[^\n;&|()`]*?\spush(?![\w-])/g) || []).length;
}

// Heredocs. A body is stripped from the executed text and reported, with
// `inert` true only when its command is a known data sink (cat, tee, grep,
// `git commit -F -`, `gh … --body-file -` and the like), is not inside
// `$(…)`/`<(…)`/backticks, and is not piped into anything but a plain filter.
// The caller still treats every body as live when the script runs a file
// through a shell. Anything this reader cannot delimit exactly — a delimiter
// that is not a bare or wholly quoted identifier, two heredocs on one line —
// stops stripping and marks the script `unsure`. `<<` inside `$((…))`,
// `((…))` or `$[…]` arithmetic is a shift, not a heredoc.
const DATA_SINKS = new Set(["cat", "tee", "grep", "egrep", "fgrep", "rg", "head", "tail", "sort", "uniq", "wc", "less", "more", "column", "jq"]);
const SAFE_FILTERS = new Set(["cat", "tee", "grep", "egrep", "fgrep", "rg", "head", "tail", "sort", "uniq", "wc", "cut", "tr", "less", "more", "column", "jq"]);

function dataSinkCommand(words) {
  const [head, ...rest] = words;
  const name = basename(head || "");
  if (DATA_SINKS.has(name)) return true;
  if (name === "git") return ["commit", "tag", "notes"].includes(rest.find((word) => !word.startsWith("-"))) && !rest.includes("-c");
  if (name === "gh") return !rest.some((word) => /merge|^api$/.test(word)) && rest.some((word) => /^(?:--body-file|-F)(?:=-)?$/.test(word));
  return false;
}

// Words of the simple command around a heredoc operator, without redirections.
function heredocCommandWords(before, after) {
  const left = before.split(/;|&&|\|\||\||\(|\)|\{|\}|`/).pop();
  const right = after.split(/;|&&|\|\||\||\)|`/)[0];
  const words = `${left} ${right}`.trim().split(/\s+/).filter(Boolean)
    .map((word) => word.replace(/['"]/g, ""));
  const kept = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (/^\d*(?:<<-?|<<<|<|>>|>|&>|>&)$/.test(word)) { index += 1; continue; } // operator then target
    if (/^\d*(?:<<|<|>>|>|&>|>&)/.test(word)) continue; // attached target
    if (!kept.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(word)) continue;
    kept.push(word);
  }
  return kept;
}

function heredocDelimiterWord(rest) {
  const word = rest.match(/^<<-?[ \t]*([^\s;|&<>()]+)/)?.[1];
  if (!word) return null;
  const quoted = word.match(/^(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|\\([A-Za-z_][A-Za-z0-9_]*)|([A-Za-z_][A-Za-z0-9_]*))$/);
  return quoted ? { delimiter: quoted[1] ?? quoted[2] ?? quoted[3] ?? quoted[4], length: rest.indexOf(word) + word.length } : null;
}

function skipArithmetic(line, index) {
  let depth = 0;
  const open = line[index] === "[" ? "[" : "(";
  const close = open === "[" ? "]" : ")";
  for (; index < line.length; index += 1) {
    if (line[index] === open) depth += 1;
    else if (line[index] === close && --depth === 0) break;
  }
  return index;
}

// Scan one line: { opener, unsure }. `opener` is { delimiter, inert }.
function heredocOpener(line, lexical) {
  let opener = null;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\\" && lexical.quote !== "'") { index += 1; continue; }
    if (lexical.quote) {
      if (char === lexical.quote) lexical.quote = null;
      continue;
    }
    if (char === "'" || char === '"') { lexical.quote = char; continue; }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) break;
    if ((char === "(" && line[index + 1] === "(") || (char === "$" && line[index + 1] === "[")) {
      index = skipArithmetic(line, char === "$" ? index + 1 : index);
      continue;
    }
    if (char !== "<" || line[index + 1] !== "<") continue;
    if (line[index + 2] === "<") { index += 2; continue; } // here-string
    const word = heredocDelimiterWord(line.slice(index));
    if (!word || opener) return { opener: null, unsure: true };
    const before = line.slice(0, index);
    const after = line.slice(index + word.length);
    const substituted = /\$\(|<\(|>\(|`/.test(before);
    const pipes = [...after.matchAll(/(?<!\|)\|(?!\|)\s*([^\s|;&)]+)/g)].map((match) => basename(match[1]));
    const inert = !substituted && dataSinkCommand(heredocCommandWords(before, after)) &&
      pipes.every((consumer) => SAFE_FILTERS.has(consumer));
    opener = { delimiter: word.delimiter, inert };
    index += word.length - 1;
  }
  return { opener, unsure: false };
}

function stripHeredocs(text) {
  if (!text.includes("<<")) return { text, bodies: [], unsure: false };
  const out = [];
  const bodies = [];
  let open = null;
  let body = [];
  const lexical = { quote: null }; // Shell quotes may span physical lines.
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (open) {
      if (line.trim() === open.delimiter) {
        bodies.push({ text: body.join("\n"), inert: open.inert });
        open = null;
        body = [];
      } else body.push(line);
      continue;
    }
    out.push(line);
    const scanned = heredocOpener(line, lexical);
    if (scanned.unsure) {
      return { text: [...out, ...lines.slice(index + 1)].join("\n"), bodies, unsure: true };
    }
    open = scanned.opener;
  }
  // An unterminated heredoc runs to the end of the script.
  if (open) bodies.push({ text: body.join("\n"), inert: false });
  return { text: out.join("\n"), bodies, unsure: false };
}

// Whether a simple command runs a script file or stdin through a shell, or a
// script by path: then any text this script wrote may be executed.
function runsScript(tokens) {
  const head = tokens[0] || "";
  return SHELLS.has(basename(head)) || head === "source" || head === "." ||
    /^\.{1,2}\//.test(head) || /\.(?:sh|bash|zsh|command)$/.test(head);
}

// Also sheds grouping punctuation, so `(gh` and `7)` tokenize as `gh` and `7`.
// One quote-aware pass over the whole command text: quoted runs stay a single
// token (so a quoted separator cannot manufacture a segment and a quoted
// `--help` is a value, not an option), and unquoted separators end a command.
// Parens separate too — they close a subshell, terminate a case pattern, and
// open a substitution, all places a merge hides behind a non-gh first token.
function tokenizeSegments(text) {
  const segments = [];
  let tokens = [];
  let current = "";
  let quote = null;
  // Substitutions opened inside double quotes, innermost last: each resumes
  // the quote when it closes. `depth` counts parens nested inside it.
  const substitutions = [];
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
      else if (quote === '"' && ((char === "$" && text[i + 1] === "(") || char === "`")) {
        // `"$(gh pr merge 7)"` and "`gh pr merge 7`" still run the command:
        // leave quote mode for the substitution so it is parsed as commands.
        endSegment();
        if (char === "$") i += 1;
        substitutions.push({ backtick: char === "`", depth: 0 });
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
      if (substitutions.at(-1)?.backtick) {
        substitutions.pop();
        quote = '"'; // back inside the surrounding quotes
      }
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
      const open = substitutions.at(-1);
      if (open && !open.backtick && char === "(") open.depth += 1;
      if (char === ")" && open && !open.backtick && open.depth === 0) {
        substitutions.pop();
        quote = '"'; // back inside the surrounding quotes
      } else {
        if (char === ")" && open && !open.backtick) open.depth -= 1;
        segments.push([char]); // marker: a subshell scopes `cd`
      }
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
  while (rest[0] && (rest[0].startsWith("-") || (!isEnv && rest[0].startsWith("+")))) {
    const token = rest[0];
    rest = rest.slice(1);
    if (!isEnv && SHELL_VALUE_OPTIONS.has(token)) { rest = rest.slice(1); continue; }
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

// Commands that run the rest of their arguments as a command: the options
// that take a separate value, and how many operands precede the command.
// `timeout 60 gh pr merge 7` is still a merge.
const COMMAND_WRAPPERS = new Map([
  ["timeout", { values: ["-s", "--signal", "-k", "--kill-after"], operands: 1 }],
  ["gtimeout", { values: ["-s", "--signal", "-k", "--kill-after"], operands: 1 }],
  ["nice", { values: ["-n", "--adjustment"], operands: 0 }],
  ["nohup", { values: [], operands: 0 }],
  ["command", { values: [], operands: 0 }],
  ["builtin", { values: [], operands: 0 }],
  ["exec", { values: ["-a"], operands: 0 }],
  ["time", { values: ["-f", "--format", "-o", "--output"], operands: 0 }],
  ["caffeinate", { values: ["-t", "-w"], operands: 0 }],
  ["sudo", {
    values: ["-u", "--user", "-g", "--group", "-h", "--host", "-p", "--prompt", "-C", "--close-from",
      "-D", "--chdir", "-r", "--role", "-t", "--type", "-U", "--other-user", "-T", "--command-timeout"],
    operands: 0,
  }],
  ["xargs", {
    values: ["-I", "-i", "-n", "--max-args", "-L", "--max-lines", "-P", "--max-procs", "-s", "--max-chars",
      "-d", "--delimiter", "-E", "-e", "-a", "--arg-file", "-J", "-R"],
    operands: 0,
  }],
]);

function skipWrapper(rest, spec) {
  let index = 0;
  while (index < rest.length && rest[index].startsWith("-") && rest[index] !== "-") {
    const token = rest[index];
    index += 1;
    if (token === "--") break;
    if (token.includes("=")) continue;
    // A separate value, unless attached (`-n5`, `-I{}`).
    if (spec.values.includes(token)) index += 1;
  }
  return rest.slice(index + spec.operands);
}

// `sudo -D DIR` / `--chdir=DIR` runs the command in DIR: the directory, or
// null when sudo does not change it.
function sudoChdir(rest) {
  for (let index = 0; index < rest.length && rest[index].startsWith("-") && rest[index] !== "--"; index += 1) {
    const token = rest[index];
    if (token === "-D" || token === "--chdir") return rest[index + 1] ?? "";
    if (token.startsWith("--chdir=")) return token.slice("--chdir=".length);
    if (/^-D./.test(token)) return token.slice(2);
    if (COMMAND_WRAPPERS.get("sudo").values.includes(token)) index += 1;
  }
  return null;
}

// Peel only the known env/shell/command wrappers. Keep their context with an
// extracted script instead of re-parsing it later against the hook's ambient
// settings.
function commandPrefix(segmentTokens, baseCwd, inherited = {}) {
  let tokens = segmentTokens.map((t) => t.replace(/^!+/, "")).filter(Boolean);
  const context = {
    env: { ...inherited.env }, unset: [...(inherited.unset || [])],
    ignoreEnv: inherited.ignoreEnv || false, cwd: baseCwd,
    cwdUnknown: inherited.cwdUnknown || false,
    shell: false, // a shell interpreter was peeled
    appendsArgs: inherited.appendsArgs || false, // xargs adds arguments read from stdin
  };
  for (;;) {
    const head = tokens[0];
    if (!head) return { ...context, tokens };
    if (CONTROL_WORDS.has(head)) { tokens = tokens.slice(1); continue; }
    // zsh `repeat N cmd` / `repeat N do … done` runs its body N times.
    if (head === "repeat") { tokens = tokens.slice(2); continue; }
    // `eval gh pr merge 7` runs its joined arguments as a script.
    if (head === "eval") return { ...context, script: tokens.slice(1).join(" ") };
    const assignment = head.match(/^([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/);
    if (assignment) {
      context.env[assignment[1]] = assignment[2];
      context.unset = context.unset.filter((name) => name !== assignment[1]);
      tokens = tokens.slice(1);
      continue;
    }
    const wrapper = COMMAND_WRAPPERS.get(basename(head));
    if (wrapper) {
      if (basename(head) === "xargs") context.appendsArgs = true;
      const chdir = basename(head) === "sudo" ? sudoChdir(tokens.slice(1)) : null;
      if (chdir !== null) {
        if (!chdir || /[$`~*?[\]]/.test(chdir)) context.cwdUnknown = true;
        else context.cwd = path.resolve(context.cwd || process.cwd(), chdir);
      }
      tokens = skipWrapper(tokens.slice(1), wrapper);
      continue;
    }
    if (basename(head) !== "env" && !SHELLS.has(basename(head))) return { ...context, tokens };
    const dropped = dropWrapperFlags(tokens);
    if (basename(head) !== "env") context.shell = true;
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
    if (context.shell) {
      // `bash <<< 'gh pr merge 7'`: the here-string is the shell's script.
      if (tokens[0] === "<<<") return { ...context, script: tokens[1] ?? "" };
      if (tokens[0]?.startsWith("<<<")) return { ...context, script: tokens[0].slice(3) };
      if (tokens[0] && /\s/.test(tokens[0])) return { ...context, script: tokens[0] };
    }
  }
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
      for (let c = 0; c < chars.length; c += 1) {
        const short = "-" + chars[c];
        if (SHORT_VALUE_FLAGS.has(short)) {
          const attached = chars.slice(c + 1).replace(/^=/, "");
          if (attached) flags.set(short, attached);
          else {
            flags.set(short, tokens[i + 1] ?? true);
            i += 1;
          }
          break;
        }
        flags.set(short, true);
      }
    } else if (VALUE_FLAGS.has(token)) {
      flags.set(token, tokens[i + 1] ?? true);
      i += 1; // consume the value so it is never read as an option
    } else {
      flags.set(token, true);
    }
  }
  return { words, flags };
}

// Codex's shell tool sends argv such as ["bash", "-lc", SCRIPT] (or `-c`,
// `-euc`, `-eu -o pipefail -c`). That outer shell is the harness's own, like
// Claude Code's Bash string, so SCRIPT is the command text. Every other shape
// joins its argv (see commandText).
function commandScript(args) {
  const sources = [args.command, args.cmd, args.input].filter((v) => v !== undefined && v !== null);
  const [argv] = sources;
  if (sources.length !== 1 || !Array.isArray(argv) || argv.length < 3 ||
      !argv.every((v) => typeof v === "string") || !SHELLS.has(basename(argv[0]))) {
    return commandText(args);
  }
  let command = false;
  for (let index = 1; index < argv.length - 1; index += 1) {
    const option = argv[index];
    if (SHELL_VALUE_OPTIONS.has(option)) { index += 1; continue; }
    if (!/^[-+][A-Za-z]+$/.test(option)) return commandText(args);
    if (option.startsWith("-") && option.includes("c")) command = true;
  }
  return command ? argv.at(-1) : commandText(args);
}

module.exports = {
  CONTROL_WORDS, SAFE_FILTERS, SHELLS, basename, commandPrefix, commandScript, mergePhraseCount,
  parseArgs, pushPhraseCount, runsScript, stripHeredocs, tokenizeSegments,
};
