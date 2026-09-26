---
layout: default
title: Work across harnesses
parent: Practices
nav_order: 6
---

# Work across harnesses

A delivery can start in Claude Code, hand a bounded unit of work to Codex, and bring the evidence back to the one workflow that owns it. Record the harness, model, and effort at each handoff so the request stays coherent and every handoff can be inspected.

## Easy path

```text
> Hand this bounded change to Codex and show me which model and effort you picked.
```

`railyard:model-routing` helps choose the model and effort for the unit of work.

## What happens

Native subagents in the same harness are the default. Crossing harnesses is opt-in, and the destination CLI has to be set up separately. Report an unsupported selection; don't change the model, effort, or provider without saying so.

## Session model and delegated model are different

Pick the interactive session for the conversation, and pick the model for each delegated unit of work. Choose an effort with the model wherever the model exposes one; Haiku 4.5 has no effort setting.

- **Claude Code:** Opus 5.5 at `medium` handles substantive subagent work, Fable 5.1 is the escalation for frontier-hard or long autonomous work, Sonnet 5 takes bounded edits, and Haiku 4.5 takes read-only search.
- **Codex:** GPT-6 Sol at `medium` is the baseline, Luna takes bounded work, and Astra takes hard work.

Leaving the model unset means the child inherits the parent's. In Codex, a full-history fork inherits both settings; changing either one needs a limited-history or no-history fork and a sufficient brief. Check the actual tool schema before dispatch, and keep the requested selection separate from the runtime metadata that shows what ran.

## Handoffs keep one owner

Claude Code reaches Codex models through a Codex CLI worker. Codex reaches Claude review through Compound Engineering's `claude -p` adapter. Either harness can get a ChatGPT Pro second opinion through [Oracle](/skills/oracle/). Create a visible provider-owned task only when the user explicitly asks for one; an unavailable transport doesn't justify creating one as a fallback.

## Next

[Control model cost](/what-it-does/control-model-cost/) or [read model routing](/delivery/model-routing/).
