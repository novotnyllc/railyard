#!/usr/bin/env node
/**
 * Detached relaunch watchdog for a desktop recycle. Armed before the quit is
 * sent, it outlives the recycle process: it waits (bounded) for the exact host
 * birth to exit, waits a short grace for the recycle's own relaunch, and then,
 * only if no instance of that bundle is running, reopens it in the background
 * (`open -g`, which neither launches a second copy nor takes focus).
 *
 * It covers the recycle process being killed after the quit, a quit that lands
 * after the recycle's own timeout, and an exception before its relaunch.
 */

import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { OPEN, PS } from "./constants.mjs";
import { collectExactProcessIdentity } from "./inventory.mjs";
import { defaultRunner, safeRun, sleepSync } from "./process-evidence.mjs";
import { observeBirth } from "./snapshot.mjs";

export const WATCHDOG_TIMEOUT_MS = 10 * 60 * 1000;
export const WATCHDOG_GRACE_MS = 5_000;
export const WATCHDOG_POLL_MS = 1_000;
const MAIN_APP_BUNDLE = /^\/.+\/(?:Codex|ChatGPT)\.app$/i;

export function validRelaunchPath(bundlePath) {
  return typeof bundlePath === "string" && MAIN_APP_BUNDLE.test(bundlePath)
    && !bundlePath.split("/").some((part) => part === "." || part === "..")
    && !bundlePath.includes("//");
}

// Whether a main-app process of this bundle is running: true, false, or null
// when the process list cannot be read.
export function bundleRunning(bundlePath, runner = defaultRunner) {
  const run = safeRun(runner, PS, ["-axo", "command="], { timeout: 5_000 });
  if (run.status !== 0 || typeof run.stdout !== "string") return null;
  const prefix = `${bundlePath}/Contents/MacOS/`;
  return run.stdout.split("\n").some((line) => line.trim().startsWith(prefix));
}

export function runRelaunchWatchdog(
  { hostPid, hostStartTime, bundlePath, timeoutMs = WATCHDOG_TIMEOUT_MS, graceMs = WATCHDOG_GRACE_MS, pollMs = WATCHDOG_POLL_MS },
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
  let launched = false;
  try {
    launched = launch(bundlePath);
  } catch {}
  return launched ? "relaunched" : "launch-failed";
}

// Start the watchdog detached from this process, so it survives it.
export function armRelaunchWatchdog(args, { spawnProcess = spawn, execPath = process.execPath } = {}) {
  if (!validRelaunchPath(args?.bundlePath)) return { ok: false };
  const child = spawnProcess(execPath, [fileURLToPath(import.meta.url), JSON.stringify(args)], {
    detached: true,
    stdio: "ignore",
  });
  child.on?.("error", () => {});
  child.unref?.();
  return { ok: Number.isInteger(child.pid) && child.pid > 0, pid: child.pid ?? null };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  let args = null;
  try {
    args = JSON.parse(process.argv[2] ?? "");
  } catch {}
  runRelaunchWatchdog(args ?? {}, {
    readIdentity: (pid) => collectExactProcessIdentity(pid, { runner: defaultRunner }),
    isRunning: (bundlePath) => bundleRunning(bundlePath),
    launch: (bundlePath) => safeRun(defaultRunner, OPEN, ["-g", bundlePath], { timeout: 20_000 }).status === 0,
    sleep: sleepSync,
    now: () => Date.now(),
  });
}
