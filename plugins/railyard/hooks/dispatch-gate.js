#!/usr/bin/env node
// PreToolUse: enforce the explicit-model dispatch rule as mechanism, not
// prose. A subagent dispatch that omits its model (and, on Codex, effort)
// silently inherits the session's premium tier — this gate refuses the call
// with a corrective message so the model retries with the fields set.
// Cross-platform, dependency-free. Fails OPEN for anything it does not
// recognize: the gate must never break a session.
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
    }
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
    // only works when the session already runs that family, and only when
    // the active config.toml actually configures a provider for it.
    const child = args.model.trim();
    const openaiLike = (m) => /^(gpt-|o[0-9]|codex)/i.test(m);
    if (!openaiLike(child)) {
      const family = child.split(/[-.]/)[0].toLowerCase();
      const session = String(input.model || "");
      const sameFamily = session.toLowerCase().startsWith(family);
      let providerConfigured = true; // fail open when unreadable
      try {
        const fs = require("fs");
        const path = require("path");
        const os = require("os");
        const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
        const toml = fs.readFileSync(path.join(codexHome, "config.toml"), "utf8");
        providerConfigured =
          /\[model_providers\./.test(toml) &&
          toml.toLowerCase().includes(family);
      } catch {}
      if (!sameFamily || !providerConfigured) {
        block(
          "[railyard] Dispatch refused: '" + child + "' is not an OpenAI-served" +
            " model, and spawn_agent cannot switch providers — the child" +
            " inherits this thread's provider. " +
            (!providerConfigured
              ? "No model_providers entry for '" + family + "' is configured" +
                " in the active config.toml. "
              : "This session runs '" + session + "', a different family. ") +
            "Start a dedicated thread instead (thread/start with model +" +
            " modelProvider, or `codex exec -m " + child +
            " -c model_provider=<provider>`).",
        );
      }
    }
    return;
  }
  // Any other tool: allow.
});
