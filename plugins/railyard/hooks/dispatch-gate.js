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
let clip = () => undefined;
try {
  ({ record, clip } = require("./run-log.js"));
} catch {}

function shellTokens(command) {
  const tokens = [];
  let word = "";
  let quote = "";
  let escaped = false;
  const flush = () => {
    if (word) tokens.push({ kind: "word", value: word });
    word = "";
  };
  const source = String(command || "").slice(0, 32768);
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      word += char;
      escaped = false;
    } else if (char === "\\") {
      escaped = true;
    } else if (quote) {
      if (char === quote) quote = "";
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
    } else if (char === ";" || char === "|" || char === "&") {
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

function codexExecDispatches(args) {
  const command = args.command ?? args.cmd;
  if (typeof command !== "string") return [];
  const tokens = shellTokens(command);
  const dispatches = [];
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index];
    const previous = tokens[index - 1];
    if (token.kind !== "word" || !/^(?:codex|codex\.exe)$/i.test(token.value.split(/[\\/]/).pop()) || tokens[index + 1]?.value !== "exec") continue;
    if (index > 0 && previous?.kind !== "separator") continue;
    let model;
    let effort;
    let label;
    for (let cursor = index + 2; cursor < tokens.length && tokens[cursor].kind !== "separator"; cursor += 1) {
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
    dispatches.push({
      model: clip(model) || "unknown",
      effort: clip(effort, 20) || "unknown",
      label: clip(label),
    });
  }
  return dispatches;
}

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
let inputHandled = false;
let inputTimer;
function handleInput() {
  if (inputHandled) return;
  inputHandled = true;
  if (inputTimer) clearTimeout(inputTimer);
  let input;
  try {
    input = JSON.parse(raw);
  } catch {
    return; // malformed input: allow
  }
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
process.stdin.on("end", handleInput);
// Some hook runners keep stdin open after delivering the payload. Never let
// that turn a fail-open hook into a shell deadlock; parse what arrived and
// exit within the dispatch budget.
inputTimer = setTimeout(() => {
  handleInput();
  process.exit(process.exitCode || 0);
}, 50);
