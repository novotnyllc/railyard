#!/usr/bin/env node
// Show or change this repository's Railyard settings in its git config.
//   config.mjs [show]                       print the effective settings
//   config.mjs off | on                     stand Railyard down here (and in every worktree) or back up
//   config.mjs review full|light|checks     pre-push review level
//   config.mjs ce on|off                    steer toward Compound Engineering stages or not
// Run it from inside the repository, or pass --repo <dir>.
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { repoConfig, REVIEW_LEVELS } = require("../../../hooks/repo-config.js");

const args = process.argv.slice(2);
const at = args.indexOf("--repo");
const cwd = at >= 0 ? args.splice(at, 2)[1] : process.cwd();
const [action = "show", value] = args;

const git = (...gitArgs) => execFileSync("git", gitArgs, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const unset = (key) => { try { git("config", "--unset", key); } catch {} };
const fail = (message) => { console.error(message); process.exit(2); };

try { git("rev-parse", "--git-dir"); } catch { fail(`not a git repository: ${cwd}`); }

if (action === "off") git("config", "railyard.off", git("rev-parse", "--path-format=absolute", "--git-common-dir"));
else if (action === "on") unset("railyard.off");
else if (action === "review") {
  if (!REVIEW_LEVELS.includes(value)) fail(`review must be one of: ${REVIEW_LEVELS.join(", ")}`);
  if (value === "full") unset("railyard.review"); else git("config", "railyard.review", value);
} else if (action === "ce") {
  if (value !== "on" && value !== "off") fail("ce must be on or off");
  if (value === "on") unset("railyard.ce"); else git("config", "railyard.ce", "off");
} else if (action !== "show") fail("usage: config.mjs [show | off | on | review full|light|checks | ce on|off] [--repo <dir>]");

const { off, review, ce } = repoConfig(cwd);
console.log(`railyard: ${off ? "off" : "on"}  review: ${review}  ce: ${ce ? "on" : "off"}`);
