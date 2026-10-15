// Per-repository Railyard settings, read from git config (set them with the
// railyard:config skill):
//
//   railyard.off     the repository's shared git directory, as an absolute path.
//                    Railyard stands down there and in every worktree. A clone,
//                    copy or move no longer matches the path, so it comes back on.
//   railyard.review  full | light | checks: the pre-push review level (default full).
//   railyard.ce      on | off: whether startup steers toward Compound Engineering
//                    stages (default on).
//   railyard.mergeGate on | off: whether the merge gate checks PR merges here
//                    (default on). The opt-in push guard is separate.
//
// Repository git config lives in the shared git directory, so worktrees share
// it and it is never committed. review, ce and mergeGate may also be set
// globally as personal defaults; a repository's own value wins.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const REVIEW_LEVELS = ["full", "light", "checks"];
const DEFAULTS = Object.freeze({ review: "full" });

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function samePath(a, b) {
  try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); } catch { return false; }
}

function repoConfig(start) {
  const cwd = typeof start === "string" && start ? start : process.cwd();
  let raw = "";
  try { raw = git(["config", "--get-regexp", "^railyard\\."], cwd); } catch {}
  const values = {};
  for (const line of raw.split("\n")) {
    const space = line.indexOf(" ");
    if (space > 0) values[line.slice(0, space)] = line.slice(space + 1).trim();
  }
  let off = false;
  if (values["railyard.off"]) {
    try { off = samePath(values["railyard.off"], git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)); } catch {}
  }
  return {
    off,
    review: REVIEW_LEVELS.includes(values["railyard.review"]) ? values["railyard.review"] : DEFAULTS.review,
    ce: values["railyard.ce"] !== "off",
    mergeGate: values["railyard.mergegate"] !== "off",
  };
}

module.exports = { repoConfig, REVIEW_LEVELS };
