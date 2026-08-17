#!/usr/bin/env node
// Oracle leaves its automation Chrome profile marked exit_type:"Crashed",
// because the run kills the browser rather than exiting it. Chrome then shows
// the "didn't shut down correctly / restore tabs" bubble on every launch, and
// that bubble can also steal focus from the automation.
//
// It also persists window_placement, so once the window has been dragged (or
// placed) offscreen it stays offscreen for every later run.
//
// Run this before an Oracle browser run to clear both. Safe to run any time;
// it only rewrites the two keys and leaves the rest of Preferences untouched.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const prefs = join(homedir(), ".oracle", "browser-profile", "Default", "Preferences");

// REFUSE while a Chrome holds this profile. Oracle shares ONE user-data-dir
// across runs (manualLogin), Chrome keeps Preferences in memory and rewrites it
// on exit, and it is often left running between runs. Editing the file
// underneath a live Chrome is therefore either silently discarded on its next
// flush or an outright corrupting interleave - and if a second Oracle run is
// mid-flight, this would be one run mutating another's browser state.
// Does any process hold this profile? Read the process table and match in JS
// rather than shelling out with the path in the command line: `pgrep -f` scans
// full command lines, so a `sh -c 'pgrep -f -- "...--user-data-dir=<path>"'`
// matches ITS OWN shell, making the answer always "held" and this helper a
// permanent no-op. macOS pgrep has no --ignore-ancestors to opt out of that.
// This node process's own argv does not contain the path, so it cannot
// self-match.
const profileDir = join(homedir(), ".oracle", "browser-profile");
let holders = [];
try {
  holders = execFileSync("/bin/ps", ["-ax", "-o", "pid=,args="], { encoding: "utf8" })
    .split("\n")
    .filter((line) => line.includes(`--user-data-dir=${profileDir}`))
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
} catch {
  // Cannot enumerate processes: refuse rather than assume the profile is free.
  // Editing Preferences under a live Chrome is the thing this guard exists to
  // prevent, so an unknown answer must fail closed.
  console.error("cannot read the process table; not touching the oracle profile.");
  process.exit(0);
}
if (holders.length > 0) {
  console.error(`oracle profile is in use (pids: ${holders.join(", ")}); not touching it.`);
  console.error("Close the automation Chrome, or just run headless - it needs no window state.");
  process.exit(0);
}

let raw;
try {
  raw = readFileSync(prefs, "utf8");
} catch {
  process.exit(0); // No profile yet - nothing to reset, and not an error.
}

let json;
try {
  json = JSON.parse(raw);
} catch {
  console.error("oracle profile Preferences is not valid JSON; leaving it alone");
  process.exit(1);
}

const before = {
  exit: json.profile?.exit_type,
  placement: json.browser?.window_placement && { ...json.browser.window_placement },
};

json.profile = json.profile ?? {};
json.profile.exit_type = "Normal";
json.profile.exited_cleanly = true;

// Only correct a placement that is actually off the work area; a window the
// user has deliberately positioned on-screen is left as they left it.
const p = json.browser?.window_placement;
if (p) {
  const offscreen = p.right <= (p.work_area_left ?? 0) + 100
    || p.left >= (p.work_area_right ?? 99999) - 100
    || p.bottom <= (p.work_area_top ?? 0) + 100
    || p.top >= (p.work_area_bottom ?? 99999) - 100;
  if (offscreen) {
    const w = Math.min(1280, (p.work_area_right ?? 1440) - (p.work_area_left ?? 0));
    const h = Math.min(900, (p.work_area_bottom ?? 900) - (p.work_area_top ?? 0));
    json.browser.window_placement = {
      ...p,
      left: p.work_area_left ?? 0,
      top: p.work_area_top ?? 0,
      right: (p.work_area_left ?? 0) + w,
      bottom: (p.work_area_top ?? 0) + h,
      maximized: false,
    };
  }
}

writeFileSync(prefs, JSON.stringify(json));
console.log(`oracle profile reset: exit_type ${before.exit} -> Normal`
  + (before.placement && json.browser.window_placement !== before.placement
    ? `, window_placement ${before.placement.left},${before.placement.top} -> ${json.browser.window_placement.left},${json.browser.window_placement.top}`
    : ""));
