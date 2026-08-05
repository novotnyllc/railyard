#!/usr/bin/env node
// UserPromptSubmit: one-line just-in-time routing nudge, derived from the
// entry conditions of yardmaster:deliver and yardmaster:orchestrate as
// people actually phrase them. Precision over recall per bucket — task
// verbs must co-occur with software objects, list structure must co-occur
// with a task verb — so ordinary conversation stays silent. At most one
// line is ever injected. Cross-platform, dependency-free, never blocks.
let raw = "";
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
    /\b(on (my|the) (other|second) (mac|machine|laptop|desktop|computer|box)|on the (mini|studio|server|laptop|desktop|nas)\b|(on|across|to) (all|every|each)( of)?( my| the)? (machines?|macs?|hosts?|computers?|boxes)|everywhere\b|fleet-?wide|the fleet\b|remote (machine|host|mac|box))\b/i;

  // --- deliver: planning drift, PR lifecycle, software change ---
  const planning =
    /\b(brainstorm|architect(ure)?|spec( out| for)?\b|(design|plan)\s+(a|an|the|for|out|this)\b|(update|revise|rework|refine|tweak|iterate on)\s+(the\s+|our\s+|this\s+)?(plan|design|spec|architecture)\b|(the|our|this)\s+(design|architecture|spec)\b|how (should|would|do) (we|this|it|i)\b|what'?s the (right|best) way\b|trade-?offs?\b|requirements?\s+(for|around|of)\b|approach(es)? (for|to|here)\b)/i;
  const prWork =
    /\b(pr|pull request)s?\b/i.test(p) &&
    /\b(watch|babysit|drive|shepherd|review|feedback|merge|fix|land|rebase)\b/i.test(p);
  const softwareChange = taskVerb.test(p) && softwareObject.test(p);

  let line = "";
  if (severalPieces || otherMachine.test(p)) {
    line =
      "[yardmaster] Several independent pieces or another machine — that's yardmaster:orchestrate territory (readiness via roundhouse before placement).";
  } else if (planning.test(p) && softwareChange) {
    line =
      "[yardmaster] Software work: route through yardmaster:deliver — planning-only stops at the CE artifact; implementation runs to merge and proof.";
  } else if (planning.test(p)) {
    line =
      "[yardmaster] Planning/brainstorming territory — even mid-conversation, load yardmaster:deliver and route to the matching CE stage (ce-brainstorm / ce-plan / ce-debug); stop at that artifact.";
  } else if (prWork) {
    line =
      "[yardmaster] Existing-PR work: yardmaster:deliver's PR routes (ce-babysit-pr / review / feedback), with deliver owning merge and post-merge proof.";
  } else if (softwareChange) {
    line =
      "[yardmaster] Delivery intent: route through yardmaster:deliver (model-routing intake first; ends at merge + post-merge proof unless a narrower stop is asked).";
  }
  if (line) process.stdout.write(line + "\n");
  process.exit(0);
});
