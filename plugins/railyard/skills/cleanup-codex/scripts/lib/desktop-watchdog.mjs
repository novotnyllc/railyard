#!/usr/bin/env node
/**
 * Relaunch for a desktop recycle: one `launchBundle` used by the recycle and
 * by its detached watchdog.
 *
 * The watchdog is armed before the quit is sent and outlives the recycle
 * process: it waits (bounded) for the exact host birth to exit, waits a short
 * grace for the recycle's own relaunch, and then, only if no instance of that
 * bundle is running, reopens it. It covers the recycle process being killed
 * after the quit, a quit that lands late, and an exception before the
 * recycle's own relaunch.
 */

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  BUNDLE_ID,
  MAIN_APP_BUNDLE,
  MAIN_APP_EXECUTABLE_NAME,
  OPEN,
  PS,
  WATCHDOG_GRACE_MS,
  WATCHDOG_POLL_MS,
  WATCHDOG_TIMEOUT_MS,
} from "./constants.mjs";
import { collectExactProcessIdentity } from "./inventory.mjs";
import { defaultRunner, safeRun, sleepSync } from "./process-evidence.mjs";
import { observeBirth } from "./snapshot.mjs";

export function validRelaunchPath(bundlePath) {
  return typeof bundlePath === "string" && MAIN_APP_BUNDLE.test(bundlePath)
    && !bundlePath.split("/").some((part) => part === "." || part === "..")
    && !bundlePath.includes("//");
}

// Reopen the app in the background (`open -g`: it neither launches a second
// copy nor takes focus), by its exact bundle path; only if that path cannot
// be opened (say it was translocated), by its bundle id.
export function launchBundle(runner, { bundlePath, bundleId }) {
  if (!validRelaunchPath(bundlePath)) return { ok: false, by: null };
  if (safeRun(runner, OPEN, ["-g", bundlePath], { timeout: 20_000 }).status === 0) return { ok: true, by: "path" };
  if (!BUNDLE_ID.test(bundleId ?? "")) return { ok: false, by: null };
  const byId = safeRun(runner, OPEN, ["-g", "-b", bundleId], { timeout: 20_000 }).status === 0;
  return { ok: byId, by: byId ? "bundle-id" : null };
}

// Whether this user's main-app process of this bundle is running: true,
// false, or null when the process list cannot be read. Only the bundle's own
// Codex/ChatGPT executable counts, never another binary beside it in
// Contents/MacOS, and never another user's copy: either would leave this
// user's app closed.
export function bundleRunning(bundlePath, runner = defaultRunner, uid = process.getuid?.()) {
  if (!Number.isInteger(uid)) return null;
  const run = safeRun(runner, PS, ["-axo", "uid=,command="], { timeout: 5_000 });
  if (run.status !== 0 || typeof run.stdout !== "string") return null;
  const prefix = `${bundlePath}/Contents/MacOS/`;
  return run.stdout.split("\n").some((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match || Number(match[1]) !== uid || !match[2].startsWith(prefix)) return false;
    return MAIN_APP_EXECUTABLE_NAME.test(match[2].slice(prefix.length));
  });
}

export function runRelaunchWatchdog(
  { hostPid, hostStartTime, bundlePath, bundleId, timeoutMs = WATCHDOG_TIMEOUT_MS, graceMs = WATCHDOG_GRACE_MS, pollMs = WATCHDOG_POLL_MS },
  { readIdentity, isRunning, launch, sleep, now },
) {
  if (!Number.isInteger(hostPid) || typeof hostStartTime !== "string" || !validRelaunchPath(bundlePath)) {
    return "invalid-arguments";
  }
  const deadline = now() + timeoutMs;
  const host = { pid: hostPid, startTime: hostStartTime };
  while (observeBirth(host, readIdentity) !== "gone") {
    if (now() >= deadline) return "host-still-running";
    sleep(pollMs);
  }
  sleep(graceMs);
  if (isRunning(bundlePath) === true) return "already-running";
  let launched = null;
  try {
    launched = launch({ bundlePath, bundleId });
  } catch {}
  return launched?.ok ? "relaunched" : "launch-failed";
}

export function defaultWatchdogDeps(runner = defaultRunner) {
  return {
    readIdentity: (pid) => collectExactProcessIdentity(pid, { runner }),
    isRunning: (bundlePath) => bundleRunning(bundlePath, runner),
    launch: (target) => launchBundle(runner, target),
    sleep: sleepSync,
    now: () => Date.now(),
  };
}

// Start the watchdog detached from this process, so it survives it. `disarm`
// stops it (a no-op once it has exited).
export function armRelaunchWatchdog(args, { spawnProcess = spawn, execPath = process.execPath } = {}) {
  if (!validRelaunchPath(args?.bundlePath)) return { ok: false };
  const child = spawnProcess(execPath, [fileURLToPath(import.meta.url), JSON.stringify(args)], {
    detached: true,
    stdio: "ignore",
  });
  child.on?.("error", () => {});
  child.unref?.();
  return {
    ok: Number.isInteger(child.pid) && child.pid > 0,
    pid: child.pid ?? null,
    disarm: () => {
      try { child.kill?.("SIGTERM"); } catch {}
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let args = null;
  try {
    args = JSON.parse(process.argv[2] ?? "");
  } catch {}
  runRelaunchWatchdog(args ?? {}, defaultWatchdogDeps());
}
