#!/usr/bin/env node
// Establishes Oracle's config defaults for THIS host, owned by this skill.
//
// These defaults must reach every user of the plugin, so they cannot live in a
// dotfile manager: chezmoi (or any equivalent) is a personal choice, not
// something the skill may assume exists. Anything the skill needs in order to
// behave correctly is the skill's job to put there.
//
// Fills in only keys that are ABSENT. An explicit user value always wins - the
// point is a sane default, not a policy the user cannot override.
//
// Why these defaults:
//   engine: browser        - the signed-in reasoning path this skill is built
//                            around; API runs cost money and need consent.
//   browser.manualLogin    - reuse one persistent, already-signed-in profile
//                            rather than copying cookies per run.
//   browser.headless       - Oracle's headful "hide" is
//                            `--window-position=-32000,-32000`, and macOS
//                            clamps a window that far out back toward the
//                            screen, so a window appears anyway. Headless is
//                            the only way to genuinely not see one. It also
//                            sidesteps the "Chrome didn't shut down correctly /
//                            restore tabs" bubble, because no window is shown
//                            to restore into.
//   sessionRetentionHours  - keep a week of sessions so --followup and
//                            reattach have something to attach to.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const DEFAULTS = {
  engine: "browser",
  sessionRetentionHours: 168,
  browser: {
    manualLogin: true,
    headless: true,
  },
};

const configPath = process.env.ORACLE_CONFIG_PATH ?? join(homedir(), ".oracle", "config.json");

let current = {};
let existed = false;
try {
  current = JSON.parse(readFileSync(configPath, "utf8"));
  existed = true;
  if (current === null || typeof current !== "object" || Array.isArray(current)) {
    console.error(`${configPath} is not a JSON object; leaving it alone.`);
    process.exit(1);
  }
} catch (err) {
  if (existed) {
    // A file that exists but does not parse is a user problem to look at, not
    // something to silently overwrite - their settings are in there.
    console.error(`${configPath} exists but is not valid JSON; leaving it alone.`);
    process.exit(1);
  }
}

const added = [];
const merged = { ...current };
for (const [key, value] of Object.entries(DEFAULTS)) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const branch = { ...(merged[key] ?? {}) };
    for (const [k, v] of Object.entries(value)) {
      if (!(k in branch)) { branch[k] = v; added.push(`${key}.${k}=${JSON.stringify(v)}`); }
    }
    merged[key] = branch;
  } else if (!(key in merged)) {
    merged[key] = value;
    added.push(`${key}=${JSON.stringify(value)}`);
  }
}

if (added.length === 0) {
  console.log(`oracle config already complete at ${configPath}`);
  process.exit(0);
}

mkdirSync(dirname(configPath), { recursive: true });
writeFileSync(configPath, `${JSON.stringify(merged, null, 2)}\n`);
console.log(`oracle config ${existed ? "updated" : "created"} at ${configPath}: ${added.join(", ")}`);
