// Per-repository Railyard settings, read from git config (set them with the
// railyard:config skill):
//
//   railyard.off     the repository's shared git directory, as an absolute path.
//                    Railyard stands down there and in every worktree. A clone,
//                    copy or move no longer matches the path, so it comes back on.
//   railyard.review  full | light | checks: the pre-push review level (default light).
//
// Repository git config lives in the shared git directory, so worktrees share
// it and it is never committed. A repository review setting overrides the
// personal default in global git config.
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const REVIEW_LEVELS = ["full", "light", "checks"];
const DEFAULTS = Object.freeze({ review: "light" });

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function samePath(a, b) {
  try { return fs.realpathSync.native(a) === fs.realpathSync.native(b); } catch { return false; }
}

// Railyard 0.13 switched a repository off with a `railyard-off` file in its
// shared git directory naming that directory. It still counts; found with
// plain file reads so the default path spawns no extra git process.
function gitDirFor(dir) {
  const dotGit = path.join(dir, ".git");
  let stat;
  try { stat = fs.statSync(dotGit); } catch { return undefined; }
  if (stat.isDirectory()) return dotGit;
  const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
  return match ? path.resolve(dir, match[1].trim()) : undefined;
}

function markerOff(start) {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const gitDir = gitDirFor(dir);
    if (gitDir) {
      let common = gitDir;
      try { common = path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim()); } catch {}
      try { return samePath(fs.readFileSync(path.join(common, "railyard-off"), "utf8").trim(), common); } catch { return false; }
    }
    if (path.dirname(dir) === dir) return false;
  }
}

function repoConfig(start) {
  const cwd = typeof start === "string" && start ? start : process.cwd();
  let raw = "";
  try { raw = git(["config", "--get-regexp", "^railyard\\."], cwd); } catch {}
  const values = {};
  for (const line of raw.split("\n")) {
    const space = line.indexOf(" ");
    if (space <= 0) continue;
    const key = line.slice(0, space);
    if (key === "railyard.off" || key === "railyard.review") values[key] = line.slice(space + 1).trim();
  }
  let off = markerOff(cwd);
  if (!off && values["railyard.off"]) {
    try { off = samePath(values["railyard.off"], git(["rev-parse", "--path-format=absolute", "--git-common-dir"], cwd)); } catch {}
  }
  return {
    off,
    review: REVIEW_LEVELS.includes(values["railyard.review"]) ? values["railyard.review"] : DEFAULTS.review,
  };
}

module.exports = { repoConfig, REVIEW_LEVELS };
