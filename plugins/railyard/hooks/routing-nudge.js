#!/usr/bin/env node
// UserPromptSubmit: one-line just-in-time routing nudge, derived from the
// entry conditions of railyard:deliver and railyard:orchestrate as
// people actually phrase them. Precision over recall per bucket — task
// verbs must co-occur with software objects, list structure must co-occur
// with a task verb — so ordinary conversation stays silent. At most one
// line is ever injected. Cross-platform, dependency-free, never blocks.
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (raw += c));
process.stdin.on("end", () => {
  let prompt = "";
  try {
    prompt = String(JSON.parse(raw).prompt || "");
  } catch {
    process.exit(0);
  }
  const p = prompt.trim();
  if (!p || p.startsWith("/") || p.length < 12) process.exit(0);

  const taskVerb =
    /\b(implement|build|fix|ship|deliver|refactor|deploy|add|create|update|migrate|write|set up|go do)\b/i;
  const softwareObject =
    /\b(bug|feature|test|tests|code|codebase|repo|app|service|api|endpoint|branch|release|ci|pipeline|skill|plugin|script|config|schema|migration|component|page|ui|function|module|package)\b/i;

  // --- orchestrate: several pieces, other machines, fleet-wide ---
  const listItems = (p.match(/(?:^|\n|\s)(?:\d+[.)]|[-*])\s+\S/g) || []).length;
  const severalPieces =
    (listItems >= 3 && taskVerb.test(p)) ||
    /\b(in parallel|at the same time|simultaneously|while you'?re at it|these (tasks|things|changes|items)|split (this|it) up|divide (this|the work))\b/i.test(p);
  const otherMachine =
    /\b(on (my|the) (other|second) (mac|machine|laptop|desktop|computer|box)|(on|across|to) (all|every|each)( of)?( my| the)? (machines?|macs?|hosts?|computers?|boxes)|everywhere\b|fleet-?wide|the fleet\b|remote (machine|host|mac|box))\b/i;
  // The user's actual machines, from the roundhouse fleet registry: a
  // placement preposition followed by a registered machine name, alias, or
  // tailnet name. Best-effort — no config, no matching, never an error.
  const namedMachine = (() => {
    try {
      const fs = require("fs");
      const path = require("path");
      const os = require("os");
      const cfgPath =
        process.env.ROUNDHOUSE_CONFIG ||
        path.join(
          process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"),
          "roundhouse",
          "config.json",
        );
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      const names = new Set();
      const machines = cfg.machines || {};
      const entries = Array.isArray(machines)
        ? machines
        : Object.entries(machines).map(([k, v]) => ({ name: k, ...v }));
      for (const m of entries) {
        for (const n of [m.name, m.display_name, m.ssh_alias, m.hostname, m.tailnet_name]) {
          // >= 5 chars: short host names collide with ordinary English after
          // a placement preposition ("at home", "on air") and fire false
          // orchestrate nudges. Precision over recall, as everywhere here.
          if (typeof n === "string" && n.length >= 5)
            names.add(n.toLowerCase().split(".")[0]);
        }
      }
      if (!names.size) return null;
      const alt = [...names]
        .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      return new RegExp(`\\b(on|to|at|over on|from)\\s+(the\\s+)?(${alt})\\b`, "i");
    } catch {
      return null;
    }
  })();

  // --- deliver: planning drift, PR lifecycle, software change ---
  const planning =
    /\b(brainstorm|architect(ure)?|spec( out| for)?\b|(design|plan)\s+(a|an|the|for|out|this)\b|(update|revise|rework|refine|tweak|iterate on)\s+(the\s+|our\s+|this\s+)?(plan|design|spec|architecture)\b|(the|our|this)\s+(design|architecture|spec)\b|how (should|would|do) (we|this|it|i)\b|what'?s the (right|best) way\b|trade-?offs?\b|requirements?\s+(for|around|of)\b|approach(es)? (for|to|here)\b)/i;
  const maintenance =
    /\b(update|sync|refresh|upgrade|reinstall)\b/i.test(p) &&
    /\b(plugins?|skills?|marketplaces?|packages?|dotfiles|the fleet|fleet)\b/i.test(p);
  const prWork =
    /\b(pr|pull request)s?\b/i.test(p) &&
    /\b(watch|babysit|drive|shepherd|review|feedback|merge|fix|land|rebase)\b/i.test(p);
  const softwareChange = taskVerb.test(p) && softwareObject.test(p);

  let line = "";
  if (severalPieces || otherMachine.test(p) || (namedMachine && namedMachine.test(p))) {
    line =
      "[railyard] Several independent pieces or another machine — that's railyard:orchestrate territory (readiness via roundhouse before placement).";
  } else if (maintenance) {
    line =
      "[railyard] Maintenance intent: roundhouse's fleet skills (fleet-agents / fleet-update) — mechanical tier; from a premium-model session, delegate to a cheap-model child rather than running inline.";
  } else if (planning.test(p) && softwareChange) {
    line =
      "[railyard] Software work: route through railyard:deliver — planning-only stops at the CE artifact; implementation runs to merge and proof.";
  } else if (planning.test(p)) {
    line =
      "[railyard] Planning/brainstorming territory — even mid-conversation, load railyard:deliver and route to the matching CE stage (ce-brainstorm / ce-plan / ce-debug); stop at that artifact.";
  } else if (prWork) {
    line =
      "[railyard] Existing-PR work: railyard:deliver's PR routes (ce-babysit-pr / review / feedback), with deliver owning merge and post-merge proof.";
  } else if (softwareChange) {
    line =
      "[railyard] Delivery intent: route through railyard:deliver (model-routing intake first; ends at merge + post-merge proof unless a narrower stop is asked).";
  }
  if (line) process.stdout.write(line + "\n");
  // Windows pipe stdout flushes async; process.exit() here could drop the
  // line. exitCode + natural exit flushes on every platform.
  process.exitCode = 0;
});
