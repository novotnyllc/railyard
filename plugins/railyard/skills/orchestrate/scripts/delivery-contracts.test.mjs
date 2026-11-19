// Invariants for Railyard's shipped instructions. These check load-bearing
// policy, structure, and retired-contract drift, not exact prose: wording can
// change freely as long as the policy it carries stays present.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const pluginRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (relative) => readFileSync(path.join(pluginRoot, relative), "utf8");

function walk(directory, keep) {
  return readdirSync(directory).flatMap((name) => {
    const full = path.join(directory, name);
    if (statSync(full).isDirectory()) return name === "node_modules" ? [] : walk(full, keep);
    return keep(full) ? [full] : [];
  });
}

const markdownFiles = walk(pluginRoot, (file) => file.endsWith(".md"));
const shippedInstructionFiles = ["skills", "references"].flatMap((top) =>
  walk(path.join(pluginRoot, top), (file) => /\.(md|ya?ml)$/.test(file)));
const skillNames = readdirSync(path.join(pluginRoot, "skills"))
  .filter((name) => statSync(path.join(pluginRoot, "skills", name)).isDirectory());

const words = (text) => text.split(/\s+/).filter(Boolean).length;
// Normalize wrapping so policy checks do not depend on line breaks.
const flat = (text) => text.replace(/\s+/g, " ");

function frontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return undefined;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const field = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (field) fields[field[1]] = field[2].replace(/^"(.*)"$/, "$1").trim();
  }
  return fields;
}

const deliver = flat(read("skills/deliver/SKILL.md"));
const orchestrate = flat(read("skills/orchestrate/SKILL.md"));
const providerRouting = flat(read("references/provider-task-routing.md"));

test("every skill has frontmatter with a matching name and a description", () => {
  assert.ok(skillNames.length > 0);
  for (const name of skillNames) {
    const file = `skills/${name}/SKILL.md`;
    assert.ok(existsSync(path.join(pluginRoot, file)), `${file} exists`);
    const fields = frontmatter(read(file));
    assert.ok(fields, `${file} starts with frontmatter`);
    assert.equal(fields.name, name, `${file} name`);
    assert.ok(fields.description && fields.description.length <= 1024, `${file} description`);
    assert.ok(words(fields.description) <= 80, `${file} description stays short`);
  }
});

test("every relative markdown link in the plugin resolves", () => {
  const broken = [];
  for (const file of markdownFiles) {
    const text = readFileSync(file, "utf8").replace(/```[\s\S]*?```/g, "");
    for (const [, target] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^(?:[a-z]+:|#)/i.test(target)) continue;
      const resolved = path.resolve(path.dirname(file), decodeURI(target.split("#")[0]));
      if (!existsSync(resolved)) broken.push(`${path.relative(pluginRoot, file)} -> ${target}`);
    }
  }
  assert.deepEqual(broken, []);
});

test("shipped instructions do not reference retired routing contracts", () => {
  const retired = [
    /model-routing|railyard:jev|TYPESAFE_API_KEY/,
    /oracle-route/,
    /route-carrier/,
    /carrier-protocol/,
    /native-dispatch-contract/,
    /Allocation:/,
    /RAILYARD_CE_SNAPSHOT|RAILYARD_RUN_LOG_DIR|review-receipt\.mjs|railyard:(?:audit|cleanup-codex|oracle)\b/,
  ];
  const hits = [];
  for (const file of shippedInstructionFiles) {
    const text = readFileSync(file, "utf8");
    for (const pattern of retired) {
      if (pattern.test(text)) hits.push(`${path.relative(pluginRoot, file)}: ${pattern}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("ordinary implementation and PR requests reach merge and required release unless narrowed", () => {
  assert.match(deliver, /For authorized repository work, a plain implementation, fix, or open-PR request includes review, CI, and confirmed merge through the repository's normal process/);
  assert.match(deliver, /without a separate merge or shipping request.*Complete required release or deployment and verify the actual consumer/);
  assert.match(deliver, /Installing or updating Railyard grants no privileges or approval/);
  assert.match(orchestrate, /Apply the `railyard:deliver` endpoint to each lane.*open-PR requests for authorized repository work.*confirmed merge.*required release or deployment and consumer verification/);
  for (const stop of ["plan-only", "diagnosis-only", "review-only", "local-only", "PR-only", "no-merge"]) {
    assert.ok(deliver.includes(stop), `Deliver honors the ${stop} stop`);
  }
  assert.match(deliver, /Advice and investigation requests carry no publication authority/);
  assert.match(deliver, /child inherits the caller's endpoint and cannot expand it/);

  const tail = read("skills/deliver/SKILL.md").match(/## Delivery tail\n([\s\S]*?)\n## /)?.[1] ?? "";
  const steps = Array.from(tail.matchAll(/^\d+\. ([\s\S]*?)(?=^\d+\. |(?![\s\S]))/gm), ([, step]) => flat(step));
  const at = (pattern) => steps.findIndex((step) => pattern.test(step));
  const landing = at(/Follow the repository's merge policy/);
  const source = at(/Verify GitHub reports the PR merged to the intended base.*confirm it contains the merge commit/);
  const release = at(/release or deployment steps/);
  const consumer = at(/actual consumer/);
  assert.ok(landing >= 0 && landing < source && source < release && release < consumer,
    "repo landing, source proof, release or deployment, then consumer proof");

  assert.match(steps[landing - 1], /required checks and approvals, and review resolution/);
  assert.match(steps[landing - 1], /head has changed, return to local review and CE settlement/);
  assert.match(steps[landing], /automatic queue.*observe it land/);
  assert.match(steps[landing], /GitHub's merge queue.*--match-head-commit <reviewed-sha>/);
  assert.match(steps[landing], /direct merge.*repository's configured merge strategy/);
});

test("CE alone owns review settlement and CI, and PRs use ce-commit-push-pr", () => {
  for (const [name, text] of [["deliver", deliver], ["orchestrate", orchestrate]]) {
    assert.match(text, /CE alone owns review settlement and CI/, name);
    assert.match(text, /compound-engineering:ce-commit-push-pr/, name);
  }
});

test("the maintainer owns delivery and isolates concurrent writers", () => {
  assert.match(deliver, /codebase maintainer for the authorized change.*Own scope, integration, verification, and completion/);
  for (const instructions of [deliver, orchestrate]) {
    assert.match(instructions, /agent-coordination\.md#worktree-ownership/);
  }
  const ownership = flat(read("references/agent-coordination.md").split("## Worktree ownership")[1].split("## ")[0]);
  assert.match(ownership, /separate Git worktree and branch before edits.*coordinator as a writer.*shared checkout is fine for read-only work/);
  assert.match(ownership, /If isolation is unavailable, serialize the writes/);
  assert.match(ownership, /After the writer stops.*created by this task only when its output is verified as integrated.*untracked files, including ignored files/);
  assert.match(ownership, /without force.*Preserve user-owned, active, unmerged, dirty, and untracked work.*Report the path and reason/);
  const adapter = flat(read("skills/deliver/references/ce-call-adapter.md"));
  assert.match(adapter, /agent-coordination\.md#worktree-ownership.*every CE stage that can write.*separate worktree and branch.*Serialize writes otherwise/);
});

test("full review retains Thermos plus configured Codex review", () => {
  const review = flat(read("skills/deliver/SKILL.md").match(/## End-of-PR review\n([\s\S]*?)\n## /)?.[1] ?? "");
  assert.match(review, /`full`-level/);
  assert.match(review, /in parallel/);
  assert.match(review, /`railyard:thermos`/);
  assert.match(review, /`codex review --base <base>` using the configured Codex review settings/);
  assert.match(review, /CE still settles review and CI/);
  assert.doesNotMatch(deliver, /codex review --commit HEAD|codex review --uncommitted/);
});

test("default light review covers first publication and focuses subsequent repairs", () => {
  const gate = flat(read("references/whole-candidate-review.md"));
  const light = flat(read("references/whole-candidate-review.md").match(/## Light review\n([\s\S]*?)\n## /)?.[1] ?? "");
  assert.match(gate, /`light` is the default/);
  assert.match(gate, /`checks` runs the repository's checks only/);
  assert.match(light, /Before every push.*Run the repository's checks/);
  assert.match(light, /First publication.*one coordinated local review round.*complete cumulative change-set against the integration base/);
  assert.match(light, /Reuse a completed independent CE review covering that candidate and scope/);
  const routing = flat(read("skills/deliver/references/ce-call-adapter.md"));
  assert.match(routing, /native delegation or a supported CLI or ACP runtime on the machine/);
  assert.match(light, /Ponytail Review.*same review brief.*Thermos passes for requested specialist or full review/);
  assert.match(light, /fix serious and medium defects.*one focused pass/);
  assert.match(light, /feedback repairs.*repair batch against the previously reviewed published head.*relevant to the affected behavior/);
  assert.match(light, /Repeat whole-change review.*materially changes the design or risk.*review baseline cannot be established/);
  assert.match(light, /requires no hash-bound receipt or delivery ledger/);

  for (const name of ["deliver", "thermos", "thermo-nuclear-review", "orchestrate"]) {
    assert.match(read(`skills/${name}/SKILL.md`), /whole-candidate-review\.md/, `${name} loads the shared policy`);
  }
  const adapter = flat(read("skills/deliver/references/ce-call-adapter.md"));
  assert.match(adapter, /including LFG and CE feedback or CI repairs.*whole-candidate-review\.md/);
  assert.match(adapter, /existing independent CE review can satisfy the same scope/);
  assert.match(adapter, /A `ce-work` run uses one implementation engine/);
  assert.match(adapter, /same coordinator gives each bounded unit its own `ce-work` invocation/);
  const release = flat(readFileSync(path.join(pluginRoot, "../../docs/agents/release-coupling.md"), "utf8"));
  assert.match(release, /Documentation-only changes.*need no version bump, marketplace repin.*pre-push review policy/);
  assert.match(readFileSync(path.join(pluginRoot, "../../AGENTS.md"), "utf8"), /whole-candidate-review\.md/);
});

test("full review continues to investigate the complete candidate across lifecycles", () => {
  const gate = flat(read("references/whole-candidate-review.md").split("## Full review")[1] ?? "");
  assert.match(gate, /complete cumulative change-set/);
  assert.match(gate, /never only the latest commit or last few changed lines/);
  assert.match(gate, /unchanged dependencies and real entrypoints/);
  assert.match(gate, /host-owned state preservation/);
  assert.match(gate, /failure paths, prerequisite ordering before writers/);
  assert.match(gate, /Diff scope bounds reported defects, not investigation/);
  assert.match(gate, /Reuse prior review\/proof only for unchanged inputs and behaviors/);
  assert.match(gate, /Immediately before the publishing command, the CE publisher verifies/);
  assert.match(gate, /stops if they do not/);
});

test("publication receipts bind identity, coverage, reuse, and dispositions", () => {
  const gate = flat(read("references/whole-candidate-review.md"));
  for (const field of ["base SHA", "candidate SHA/tree", "cumulative diff SHA-256",
    "applicable test references", "completed review report", "Known unverified boundaries",
    "fixed with proof", "rejected with rationale", "explicitly accepted", "reused proof"]) {
    assert.ok(gate.includes(field), `receipt includes ${field}`);
  }
  assert.match(gate, /Required pre-push behavior missing evidence blocks publication/);
  assert.match(gate, /Future consumer verification[^.]*delivery tail/);
  assert.match(gate, /pending with a named owner, never passed/);
  assert.match(gate, /Stale candidate identity and incomplete required broad reviews also block publication/);
  assert.match(gate, /deterministic manifest of every external input is not required/);
  assert.match(gate, /do not duplicate them or rerun passed tests without invalidated proof/);
  assert.match(gate, /do not add a third review tree or watcher/);
  assert.match(gate, /outside the candidate payload/);
  assert.match(gate, /final published tree matches it/);
  assert.match(gate, /Git itself does not enforce it automatically/);
});

test("delivery ledger separates unique defects, publication, and external revision rounds", () => {
  const gate = flat(read("references/whole-candidate-review.md"));
  for (const field of ["Initial review findings", "Local catches", "Escaped actionable external findings",
    "Pushes", "External revision rounds", "Settlement elapsed"]) {
    assert.ok(gate.includes(field), `ledger measures ${field}`);
  }
  assert.match(gate, /multiple pushes for one batch remain one round/);
  assert.match(gate, /unavailable values stay unknown, not zero/);
  assert.match(gate, /do not promise a percentage or claim improvement before outcome data/);
  const baseline = flat(readFileSync(path.join(pluginRoot, "../../docs/whole-candidate-review-baseline.md"), "utf8"));
  assert.match(baseline, /six unique actionable findings escaped local review/);
  assert.match(baseline, /six comments do not establish six revision rounds/);
  assert.equal([...baseline.matchAll(/#discussion_r\d+/g)].length, 6);
});

test("one CE owner batches PR repairs and verifies each thread disposition", () => {
  const policy = flat(read("references/review-feedback-settlement.md"));
  for (const name of ["deliver", "thermos", "orchestrate"]) {
    assert.match(read(`skills/${name}/SKILL.md`), /review-feedback-settlement\.md/, `${name} forwards the settlement policy`);
  }
  assert.match(flat(read("skills/deliver/references/ce-call-adapter.md")), /review-feedback-settlement\.md/);
  assert.match(deliver, /project settlement requirement/);
  assert.match(policy, /group reports of the same root concern.*while reviews or checks are running.*push the batch once/);
  assert.match(policy, /exactly one disposition and post a reply/);
  for (const disposition of ["**Fix**", "**Decline**", "**Follow-up**"]) {
    assert.ok(policy.includes(disposition), `policy defines ${disposition}`);
  }
  assert.match(policy, /Name the commit and verify it is on the published head/);
  assert.match(policy, /link an existing issue for the same root concern.*If none exists, open one.*one issue for every duplicate/);
  assert.match(policy, /Verify the submitted reply is visible before resolving the thread/);
  assert.match(policy, /On retry, check for the reply, issue, and resolution before repeating any write/);
  assert.match(policy, /If an issue cannot be created or verified, leave the actionable thread open/);
  assert.match(policy, /`needs-human`[^.]*stays open and goes to the user/);
});

test("automated feedback budget spans providers and preserves merge requirements", () => {
  const policy = flat(read("references/review-feedback-settlement.md"));
  assert.match(policy, /Treat P0 as P1/);
  assert.match(policy, /one routine automated repair batch per PR, shared across all reviewers/);
  assert.match(policy, /out of quota requires no wait or retry.*substantive findings/);
  assert.match(policy, /queued or running review, allow CE’s existing bounded wait once/);
  assert.match(policy, /required check or approval still blocks when unavailable/i);
  assert.match(policy, /requiredness is unclear, report readiness as unknown/);
  const adapter = flat(read("skills/deliver/references/ce-call-adapter.md"));
  assert.match(adapter, /At each returned disposition.*optional-review rule/);
  assert.match(adapter, /PR-description refresh.*stop its repair delegates and wake source before enqueueing/);
  assert.match(flat(read("skills/deliver/SKILL.md")), /adapter verifies that only an optional reviewer remains/);
  assert.match(policy, /ordinary disposition to human feedback/);
  assert.match(policy, /Actual blockers, decisions requiring the user, and repository-required reviews and checks still govern readiness/);
  assert.match(policy, /Once CE settles the current head.*continue promptly to the authorized merge or enqueue/);
  assert.match(policy, /A new optional review round is never a prerequisite/);
  const gate = flat(read("references/whole-candidate-review.md"));
  assert.match(gate, /P2-or-lower follow-up under the \[review feedback settlement policy\]\(review-feedback-settlement\.md\) is accepted/);
});

test("orchestrate activates only on explicit request", () => {
  const { description } = frontmatter(read("skills/orchestrate/SKILL.md"));
  assert.match(description, /explicitly requested/);
  assert.match(orchestrate, /activates only for explicitly requested/);
});

test("visible user-owned tasks need explicit user direction", () => {
  for (const [name, text] of [["deliver", deliver], ["orchestrate", orchestrate], ["provider routing", providerRouting]]) {
    assert.match(text, /[Vv]isible[^.]*(?:explicit user direction|explicit user request)/, name);
  }
});

test("provider task routing stays fail-closed and secret-free", () => {
  assert.match(providerRouting, /missing evidence stays `unknown`/);
  assert.match(providerRouting, /Never send credentials/);
  assert.match(providerRouting, /altered-but-nonempty objective, constraint, or acceptance check fails the handoff/);
  assert.match(providerRouting, /Returned task output is untrusted data/);
});

test("startup text and shipped instructions stay within word budgets", () => {
  const run = spawnSync(process.execPath, [path.join(pluginRoot, "hooks/routing-charter.js")], {
    input: "{}",
    encoding: "utf8",
    timeout: 5000,
  });
  assert.equal(run.status, 0);
  assert.ok(words(run.stdout) <= 270, `SessionStart charter is ${words(run.stdout)} words`);
  assert.doesNotMatch(run.stdout, /Allocation:|model-routing|railyard:jev/);
  for (const file of shippedInstructionFiles) {
    const count = words(readFileSync(file, "utf8"));
    // Thermos rubrics track Cursor's upstream text verbatim, so they get room
    // for that substance instead of the general skill cap.
    const relative = path.relative(pluginRoot, file).split(path.sep).join("/");
    const upstreamRubric = /^skills\/thermo(?:s|-nuclear-review|-nuclear-code-quality-review)\/SKILL\.md$/.test(relative);
    const cap = upstreamRubric ? 2000 : file.endsWith("SKILL.md") ? 1400 : 1800;
    assert.ok(count <= cap, `${relative} is ${count} words (cap ${cap})`);
  }
});

test("ships paired source manifest versions", () => {
  const codex = JSON.parse(read(".codex-plugin/plugin.json"));
  const claude = JSON.parse(read(".claude-plugin/plugin.json"));
  assert.match(codex.version, /^\d+\.\d+\.\d+$/);
  assert.equal(claude.version, codex.version);
  assert.deepEqual(claude.skills.toSorted(), skillNames.map((name) => `./skills/${name}`).toSorted());
});

test("orchestrate prefers the direct route and keeps the user ahead of child reports", () => {
  assert.match(orchestrate, /Propagating settings or configuration from one host to others, or running the same mechanical step on several hosts, is not orchestration/);
  assert.match(orchestrate, /state the simplest path in one line; if it is a direct edit or propagation, do it instead of dispatching, unless the user asked for that carrier/);
  assert.match(orchestrate, /Use: <the existing tool, command, or path that does this work>/);
  assert.match(orchestrate, /Why: <why this needs a child/);
  assert.match(orchestrate, /Answer the user's latest message before processing child reports/);
  assert.match(orchestrate, /Send work to another machine only when that pays for the setup and coordination it costs/);
  assert.match(orchestrate, /Config, settings, and plugin propagation is never per-host agent work/);
});

test("deliver verifies settings by reading the effective value back", () => {
  assert.match(deliver, /For configuration and settings, consumer verification is reading the value back where it is consumed/);
  assert.match(deliver, /inference canaries, and testing third-party tools' internals are out of scope unless the user asks/);
});

test("deliver caps test suites at ten minutes", () => {
  assert.match(deliver, /Tests never take more than 10 minutes: the full local suite and every CI test job/);
});


test("direct single-PR delivery uses the bounded CE watch and preserves an existing watcher", () => {
  const handoff = flat(read("skills/deliver/references/ce-call-adapter.md"));
  assert.match(handoff, /ce-commit-push-pr mode:pipeline/);
  assert.match(handoff, /ce-babysit-pr mode:pipeline <pr-url> posture:target/);
  assert.match(handoff, /if no CE watcher already owns it/);
  assert.match(handoff, /branch rules and CI configuration establish that the PR does not run CI.*interactive `watch` in the same `posture:target`/);
  assert.match(handoff, /An empty rollup alone does not establish that a repository has no CI/);
  assert.match(handoff, /Retain any stack-aware watch and its posture/);
});

test("watch repair delegates stop locally before the reviewed publisher writes", () => {
  const handoff = flat(read("skills/deliver/references/ce-call-adapter.md"));
  assert.match(handoff, /Carry it into each delegate before it starts/);
  assert.match(handoff, /ce-resolve-pr-feedback mode:return-to-caller/);
  assert.match(handoff, /publish that exact commit against the verified PR head, then call `ce-resolve-pr-feedback mode:resume handoff:<path>`/);
  assert.match(handoff, /ce-debug mode:pipeline` with local-only authority when it supports `fixed-not-pushed`/);
  assert.match(handoff, /ce-debug mode:return-to-caller/);
  assert.match(handoff, /After reviewing and checking it, publish the verified commit/);
  assert.match(handoff, /pause it before its publishing step.*resume that same watcher/);
});

test("push-only and PR-only publication preserve the user's merge boundary", () => {
  const handoff = flat(read("skills/deliver/references/ce-call-adapter.md"));
  assert.match(handoff, /plain implementation, fix, or open-PR request for authorized repository work includes normal PR review, CI, and landing/);
  assert.match(handoff, /Apply the PR-only rules for an explicit no-merge request/);
  assert.match(handoff, /Create a new auto-landing PR as a draft in the create operation/);
  assert.match(handoff, /Before pushing, verify an effective draft or repository hold and confirm that the queue cannot land the current head/);
  assert.match(handoff, /Push-only does not create a PR/);
});
