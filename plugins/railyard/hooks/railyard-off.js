// Railyard stands down in a repository whose shared git directory (the
// common dir every worktree points back to) holds a `railyard-off` file
// naming that directory's own path. All of the repository's worktrees are
// off together. The marker is never committed, a clone never copies it, and
// a copied or moved repository no longer matches it, so Railyard comes back
// on everywhere else.
const fs = require("node:fs");
const path = require("node:path");

function gitDirFor(dir) {
  const dotGit = path.join(dir, ".git");
  let stat;
  try { stat = fs.statSync(dotGit); } catch { return undefined; }
  if (stat.isDirectory()) return dotGit;
  const match = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
  return match ? path.resolve(dir, match[1].trim()) : undefined;
}

function commonDirFor(gitDir) {
  try { return path.resolve(gitDir, fs.readFileSync(path.join(gitDir, "commondir"), "utf8").trim()); }
  catch { return gitDir; }
}

function markerMatches(commonDir) {
  try {
    const named = fs.readFileSync(path.join(commonDir, "railyard-off"), "utf8").trim();
    return named !== "" && fs.realpathSync.native(named) === fs.realpathSync.native(commonDir);
  } catch { return false; }
}

function railyardOff(start) {
  let dir = path.resolve(typeof start === "string" && start ? start : process.cwd());
  for (;;) {
    const gitDir = gitDirFor(dir);
    if (gitDir) return markerMatches(commonDirFor(gitDir));
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

module.exports = { railyardOff };
