#!/usr/bin/env node
// PreToolUse: enforce the explicit-model dispatch rule as mechanism, not
// prose. A subagent dispatch that omits its model (and, on Codex, effort)
// silently inherits the session's premium tier — this gate refuses the call
// with a corrective message so the model retries with the fields set.
// Cross-platform, dependency-free. Fails OPEN for anything it does not
// recognize: the gate must never break a session.
//
// It also records every ALLOWED dispatch to the run log — the mechanical
// half of railyard:audit. Recording is best-effort and never affects the
// verdict: a missing or broken recorder leaves the gate exactly as it was.
let record = () => {};
let clip = (value, max = 120) => {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
};
try {
  ({ record, clip } = require("./run-log.js"));
} catch {}

function shellTokens(command) {
  const tokens = [];
  let word = "";
  let quote = "";
  let doubleQuoteSubstitution = null;
  let escaped = false;
  const flush = () => {
    if (word) tokens.push({ kind: "word", value: word });
    word = "";
  };
  const source = maskHeredocBodies(String(command || ""));
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      if (char !== "\n" && !(char === "\r" && source[index + 1] === "\n")) word += char;
      if (char === "\r" && source[index + 1] === "\n") index += 1;
      escaped = false;
    } else if (char === "\\") {
      const next = source[index + 1];
      if (next && /[\s'"\\;|&#$`{}]/.test(next)) escaped = true;
      else word += char;
    } else if (quote) {
      if (quote === '"' && char === "$" && source[index + 1] === "(") {
        flush();
        tokens.push({ kind: "separator" });
        doubleQuoteSubstitution = "paren";
        quote = "";
        index += 1;
      } else if (quote === '"' && char === "`") {
        flush();
        tokens.push({ kind: "separator" });
        doubleQuoteSubstitution = "backtick";
        quote = "";
      } else if (char === quote) quote = "";
      else word += char;
    } else if (char === "'" || char === '"') {
      quote = char;
    } else if (char === "#" && !word) {
      // A comment starts only at a word boundary. Ignore it until the next
      // line so commented-out examples cannot become audit records.
      while (index + 1 < source.length && source[index + 1] !== "\n") index += 1;
    } else if (/\s/.test(char)) {
      flush();
      if (char === "\n") tokens.push({ kind: "separator" });
    } else if ((doubleQuoteSubstitution === "paren" && char === ")") || (doubleQuoteSubstitution === "backtick" && char === "`")) {
      flush();
      tokens.push({ kind: "separator" });
      doubleQuoteSubstitution = null;
      quote = '"';
    } else if (char === "<" || char === ">") {
      flush();
      let operator = char;
      if (source[index + 1] === char) {
        operator += char;
        index += 1;
      }
      if (source[index + 1] === "&") {
        operator += "&";
        index += 1;
      }
      tokens.push({ kind: "redirection", value: operator });
    } else if (char === ";" || char === "|" || char === "&" || char === "(" || char === ")" || char === "{" || char === "}" || char === "`") {
      flush();
      tokens.push({ kind: "separator" });
    } else {
      word += char;
    }
  }
  if (escaped) word += "\\";
  flush();
  return tokens;
}

function isAssignment(value) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);
}

function basename(value) {
  return value.split(/[\\/]/).pop();
}

const SHELL_CONTROL_WORDS = new Set(["if", "then", "elif", "else", "while", "until", "do", "!"]);
const SHELL_LAUNCHERS = new Set(["bash", "sh", "zsh", "dash", "ksh", "fish"]);
const MAX_SHELL_WRAPPER_DEPTH = 4;

function heredocSpecs(line) {
  const specs = [];
  let quote = "";
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) break;
    if (char !== "<" || line[index + 1] !== "<" || line[index + 2] === "<") continue;
    let cursor = index + 2;
    const stripTabs = line[cursor] === "-";
    if (stripTabs) cursor += 1;
    while (/\s/.test(line[cursor] || "")) cursor += 1;
    let delimiter = "";
    if (line[cursor] === "'" || line[cursor] === '"') {
      const delimiterQuote = line[cursor++];
      const end = line.indexOf(delimiterQuote, cursor);
      if (end < 0) continue;
      delimiter = line.slice(cursor, end);
      cursor = end + 1;
    } else {
      const start = cursor;
      while (cursor < line.length && !/[\s;|&<>()[\]{}]/.test(line[cursor])) cursor += 1;
      delimiter = line.slice(start, cursor);
    }
    if (delimiter) specs.push({ delimiter, stripTabs });
    index = Math.max(index, cursor - 1);
  }
  return specs;
}

function maskHeredocBodies(source) {
  const lines = source.split("\n");
  const pending = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (pending.length) {
      const comparable = line.endsWith("\r") ? line.slice(0, -1) : line;
      const expected = pending[0];
      if (comparable === expected.delimiter || (expected.stripTabs && comparable.replace(/^\t+/, "") === expected.delimiter)) pending.shift();
      lines[index] = line.replace(/[^\r]/g, " ");
      continue;
    }
    pending.push(...heredocSpecs(line));
  }
  return lines.join("\n");
}

function skipRedirection(tokens, cursor, index) {
  if (tokens[cursor]?.kind === "word" && /^\d+$/.test(tokens[cursor].value) && tokens[cursor + 1]?.kind === "redirection") cursor += 1;
  if (tokens[cursor]?.kind !== "redirection") return null;
  cursor += 1;
  if (cursor < index && tokens[cursor]?.kind === "word") cursor += 1;
  return cursor;
}

function commandPrefixAllows(tokens, index) {
  let start = index;
  while (start > 0 && tokens[start - 1].kind !== "separator") start -= 1;
  let cursor = start;
  while (cursor < index) {
    const afterRedirection = skipRedirection(tokens, cursor, index);
    if (afterRedirection !== null) {
      cursor = afterRedirection;
      continue;
    }
    while (cursor < index && tokens[cursor].kind === "word" && isAssignment(tokens[cursor].value)) cursor += 1;
    if (cursor >= index || tokens[cursor].kind !== "word") break;
    if (SHELL_CONTROL_WORDS.has(tokens[cursor].value)) {
      cursor += 1;
      continue;
    }
    const launcher = basename(tokens[cursor].value);
    if (launcher === "env") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value === "-i" || value === "--ignore-environment") {
          cursor += 1;
          continue;
        }
        if (value === "-u" || value === "--unset") {
          cursor += 2;
          continue;
        }
        if (isAssignment(value)) {
          cursor += 1;
          continue;
        }
        break;
      }
      continue;
    }
    if (launcher === "command") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word" && ["-p", "--"].includes(tokens[cursor].value)) cursor += 1;
      continue;
    }
    if (launcher === "timeout") {
      cursor += 1;
      const optionsWithArguments = new Set(["-k", "--kill-after", "-s", "--signal"]);
      while (cursor < index && tokens[cursor].kind === "word") {
        const value = tokens[cursor].value;
        if (value === "--") {
          cursor += 1;
          break;
        }
        if (value.startsWith("-")) {
          cursor += 1;
          if (optionsWithArguments.has(value) && cursor < index) cursor += 1;
          continue;
        }
        cursor += 1; // timeout duration
        break;
      }
      continue;
    }
    if (launcher === "nohup") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word" && (tokens[cursor].value === "--" || tokens[cursor].value.startsWith("-"))) cursor += 1;
      continue;
    }
    if (launcher === "time") {
      cursor += 1;
      while (cursor < index && tokens[cursor].kind === "word" && tokens[cursor].value.startsWith("-")) {
        const value = tokens[cursor].value;
        cursor += 1;
        if (["-f", "--format", "-o", "--output"].includes(value) && cursor < index) cursor += 1;
      }
      continue;
    }
    break;
  }
  return cursor === index;
}

function shellWrapperTokens(tokens, depth = 0) {
  if (depth >= MAX_SHELL_WRAPPER_DEPTH) return tokens;
  const launcher = basename(tokens[0]?.value || "").toLowerCase();
  if (!SHELL_LAUNCHERS.has(launcher)) return tokens;
  for (let index = 1; index < tokens.length - 1; index += 1) {
    if (tokens[index]?.kind !== "word") continue;
    if (tokens[index].value !== "--" && tokens[index].value !== "--command" && !/^-[^-]*c$/.test(tokens[index].value)) continue;
    const payload = tokens[index + 1];
    if (payload?.kind !== "word") return tokens;
    return shellWrapperTokens(shellTokens(payload.value), depth + 1);
  }
  return tokens;
}

function commandTokens(args) {
  const command = args.command ?? args.cmd ?? args.input;
  if (typeof command === "string") return shellWrapperTokens(shellTokens(command));
  if (!Array.isArray(command)) return [];
  const values = command.filter((value) => typeof value === "string");
  let cursor = 0;
  while (cursor < values.length) {
    const launcher = basename(values[cursor]).toLowerCase();
    if (launcher === "env") {
      cursor += 1;
      while (cursor < values.length && (values[cursor] === "--" || values[cursor].startsWith("-") || isAssignment(values[cursor]))) cursor += 1;
      continue;
    }
    if (launcher === "command") {
      cursor += 1;
      continue;
    }
    break;
  }
  return shellWrapperTokens(values.slice(cursor).map((value) => ({ kind: "word", value })));
}

function codexExecDispatches(args) {
  const tokens = commandTokens(args);
  const dispatches = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    if (token.kind !== "word" || !/^(?:codex|codex\.exe)$/i.test(token.value.split(/[\\/]/).pop()) || tokens[index + 1]?.value !== "exec") continue;
    if (!commandPrefixAllows(tokens, index)) continue;
    let model;
    let effort;
    let label;
    for (let cursor = index + 2; cursor < tokens.length && !["separator", "redirection"].includes(tokens[cursor].kind); cursor += 1) {
      const value = tokens[cursor].value;
      const next = tokens[cursor + 1]?.value;
      if (value === "-m" || value === "--model") {
        model = next;
        cursor += 1;
      } else if (value.startsWith("--model=")) {
        model = value.slice("--model=".length);
      } else if (value === "-c" || value === "--config") {
        const match = (next || "").match(/^model_reasoning_effort\s*=\s*(.+)$/);
        if (match) effort = match[1].replace(/^(['"])(.*)\1$/, "$2");
        cursor += 1;
      } else if (value.startsWith("--reasoning-effort=") || value.startsWith("--reasoning_effort=")) {
        effort = value.slice(value.indexOf("=") + 1);
      } else if (value === "--reasoning-effort" || value === "--reasoning_effort") {
        effort = next;
        cursor += 1;
      } else if (value === "--label" || value === "--task-name") {
        label = next;
        cursor += 1;
      } else if (value.startsWith("--label=") || value.startsWith("--task-name=")) {
        label = value.slice(value.indexOf("=") + 1);
      }
    }
    const clippedModel = clip(model);
    const clippedEffort = clip(effort, 20);
    dispatches.push({
      model: clippedModel,
      effort: clippedEffort,
      label: clip(label),
      missing: [!clippedModel && "model", !clippedEffort && "reasoning_effort"].filter(Boolean),
    });
  }
  return dispatches;
}

let raw = "";
process.stdin.setEncoding("utf8");
let inputHandled = false;
let inputTimer;
function armInputTimer() {
  if (inputTimer) clearTimeout(inputTimer);
  inputTimer = setTimeout(() => {
    handleInput();
    if (inputHandled) process.exit(process.exitCode || 0);
  }, 50);
}
process.stdin.on("data", (c) => {
  raw += c;
  armInputTimer();
});
function handleInput({ final = false } = {}) {
  if (inputHandled) return;
  if (inputTimer) clearTimeout(inputTimer);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    if (final) inputHandled = true;
    return; // malformed input: allow
  }
  inputHandled = true;
  const tool = String(input.tool_name || "");
  const args = input.tool_input && typeof input.tool_input === "object"
    ? input.tool_input
    : {};

  const block = (msg) => {
    process.stderr.write(msg + "\n");
    process.exitCode = 2;
  };

  if (tool === "Agent" || tool === "Task") {
    // Claude Code subagent dispatch: the model field is required. Any
    // explicit value — including the session's own tier — passes; writing
    // it is what makes an escalation named.
    if (typeof args.model !== "string" || !args.model.trim()) {
      block(
        "[railyard] Dispatch refused: every subagent names an explicit model" +
          " (no silent inheritance of the session tier). Set model:" +
          " opus for implementation/research/review, sonnet or haiku for" +
          " mechanical work; setting the session's own tier explicitly is a" +
          " named escalation. Retry the same call with the model field set.",
      );
      return;
    }
    // Cross-harness guardrail (interim): a Claude Code session dispatching a
    // subagent onto an OpenAI/Codex-family model routes work into a harness
    // that meters separately — it must be an explicit opt-in, never the
    // silent product of a harness-independent default. Refuse unless the
    // dispatch says "cross-harness" somewhere in its prompt or description.
    // The durable fix is the harness-aware router default (queued), which
    // stops the silent selection at the source; until it ships, this gate is
    // the guardrail. ponytail: substring opt-in marker, precision over
    // recall — a real cross-harness dispatch just names itself.
    const crossHarnessFamily = (m) => /^(gpt-|o[0-9]|codex)/i.test(m);
    if (crossHarnessFamily(args.model.trim())) {
      const marker = [args.prompt, args.description]
        .filter((v) => typeof v === "string")
        .join("\n");
      if (!/cross-harness/i.test(marker)) {
        block(
          "[railyard] Dispatch refused: '" + args.model.trim() + "' is an" +
            " OpenAI/Codex-family model, and this is a Claude Code session —" +
            " cross-harness dispatch meters separately and is explicit opt-in" +
            " only, never a silent default. If you truly mean to run this" +
            " worker on the other harness, say so in the dispatch (include" +
            " 'cross-harness' and the reason) and retry; otherwise route it to" +
            " a Claude model (opus/sonnet/haiku).",
        );
        return;
      }
    }
    record({
      event: "dispatch",
      harness: "claude-code",
      tool,
      model: args.model.trim(),
      role: clip(args.subagent_type, 60),
      label: clip(args.description),
      session_id: clip(input.session_id),
    });
    return;
  }

  if (tool === "spawn_agent") {
    // Codex subagent dispatch: model + reasoning_effort both required.
    const missing = [];
    if (typeof args.model !== "string" || !args.model.trim()) missing.push("model");
    if (args.reasoning_effort == null || args.reasoning_effort === "") {
      missing.push("reasoning_effort");
    }
    if (missing.length) {
      block(
        "[railyard] Dispatch refused: spawn_agent must set " +
          missing.join(" and ") +
          " explicitly (no silent inheritance of the session tier)." +
          " Retry with the fields set.",
      );
      return;
    }
    // Provider coherence: spawn_agent has no provider field — a child
    // inherits the thread's provider. A non-OpenAI child model therefore
    // only works when non-OpenAI routing is configured at all. Provider ids
    // are arbitrary and unrelated to model families (zai_litellm serves
    // glm-*), so we can only check that some [model_providers.*] section
    // exists — never claim a *named* provider is missing. The payload
    // carries no session model field, so family coherence is unknowable
    // here and is not asserted.
    // ponytail: line-anchored section grep, not a TOML parse — upgrade to a
    // real parser only if provider sections start appearing in odd shapes.
    const child = args.model.trim();
    let refused = false;
    const openaiLike = (m) => /^(gpt-|o[0-9]|codex)/i.test(m);
    if (!openaiLike(child)) {
      let providersConfigured = true; // fail open when unreadable
      try {
        const fs = require("fs");
        const path = require("path");
        const os = require("os");
        const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
        const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
        providersConfigured = /^[ \t]*\[model_providers[.\]]/m.test(toml);
      } catch {}
      if (!providersConfigured) {
        refused = true;
        block(
          "[railyard] Dispatch refused: '" + child + "' is not an OpenAI-served" +
            " model, and spawn_agent cannot switch providers — the child" +
            " inherits this thread's provider. The active config.toml declares" +
            " no [model_providers.*] section, so no non-OpenAI provider is" +
            " configured at all. Start a dedicated thread instead (thread/start" +
            " with model + modelProvider, or `codex exec -m " + child +
            " -c model_provider=<provider>`).",
        );
      }
    }
    if (!refused) {
      record({
        event: "dispatch",
        harness: "codex",
        tool,
        model: child,
        effort: clip(String(args.reasoning_effort), 20),
        label: clip(args.task_name),
        session_id: clip(input.session_id),
      });
    }
    return;
  }

  if (["Bash", "shell", "local_shell", "exec_command", "unified_exec"].includes(tool)) {
    try {
      for (const dispatch of codexExecDispatches(args)) {
        if (dispatch.missing.length) {
          block(
            "[railyard] Dispatch refused: codex exec must set explicit " +
              dispatch.missing.join(" and ") +
              " (no silent inheritance of the session tier). Retry with " +
              "--model and model_reasoning_effort set.",
          );
          return;
        }
        record({
          event: "dispatch",
          harness: "codex",
          tool,
          model: dispatch.model,
          effort: dispatch.effort,
          reasoning_effort: dispatch.effort,
          label: dispatch.label,
          session_id: clip(input.session_id),
        });
      }
    } catch {}
    return;
  }
  // Any other tool: allow.
}
process.stdin.on("end", () => handleInput({ final: true }));
// Some hook runners keep stdin open after delivering the payload. Never let
// that turn a fail-open hook into a shell deadlock; a complete payload is
// parsed and exits within the dispatch budget. Incomplete JSON stays open
// until the next chunk or stdin end, so a gap cannot bypass the gate.
