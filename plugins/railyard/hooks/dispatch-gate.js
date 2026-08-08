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

let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
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
  // Any other tool: allow.
});
