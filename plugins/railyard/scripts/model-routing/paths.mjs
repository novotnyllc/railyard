/** Path derivation and ancestor safety for the config/state files. */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  error,
  result,
} from "./bounds.mjs";

export function isAbsoluteForPlatform(candidate, platform) {
  return platform === "win32" ? path.win32.isAbsolute(candidate) : path.isAbsolute(candidate);
}

export function isNested(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

export function unsafeExternalPath(candidate, cwd) {
  const resolved = path.resolve(candidate);
  if (isNested(resolved, path.resolve(cwd))) return true;
  const parts = resolved.split(path.sep);
  if (parts.some((part, index) => part === "cache" && parts[index - 1] === "plugins" && [".codex", ".claude"].includes(parts[index - 2]))) return true;
  for (let current = path.dirname(resolved); ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, ".git"))) return true;
    if (current === path.dirname(current)) return false;
  }
}

export function stickyWorldWritable(stat) {
  return (stat.mode & 0o1000) !== 0 && (stat.mode & 0o002) !== 0;
}

/**
 * Check every existing ancestor.  Default XDG paths go through this same
 * check: an environment default is still input, not a trusted exemption.
 */
export function pathSafetyIssue(candidate, { kind, cwd, platform }) {
  if (!isAbsoluteForPlatform(candidate, platform)) return "path_not_absolute";
  const resolved = path.resolve(candidate);
  if (unsafeExternalPath(resolved, cwd)) return "unsafe_path_location";
  for (let current = resolved; ; current = path.dirname(current)) {
    const stat = safeStat(current);
    if (stat) {
      if (stat.isSymbolicLink()) return "unsafe_path_symlink";
      if (current !== resolved && !stat.isDirectory()) return "unsafe_path_ancestor";
      if (stat.isDirectory() && current !== path.parse(current).root) {
        const label = kind === "config" ? "config" : "state";
        if (typeof process.getuid === "function" && stat.uid !== process.getuid() && stat.uid !== 0 && !stickyWorldWritable(stat)) return `unexpected_${label}_directory_owner`;
        if ((stat.mode & 0o022) !== 0 && !stickyWorldWritable(stat)) return `unsafe_${label}_directory_mode`;
      }
    }
    if (current === path.dirname(current)) return null;
  }
}

export function resolvePaths({ env = process.env, home = os.homedir(), cwd = process.cwd(), platform = process.platform } = {}) {
  const configOverride = env.RAILYARD_MODEL_POLICY_PATH;
  const stateOverride = env.RAILYARD_MODEL_STATE_PATH;
  const configPath = configOverride
    ? configOverride
    : platform === "win32"
      ? path.join(env.LOCALAPPDATA || home, "railyard", "model-routing.json")
      : path.join(env.XDG_CONFIG_HOME || path.join(home, ".config"), "railyard", "model-routing.json");
  const statePath = stateOverride
    ? stateOverride
    : platform === "win32"
      ? path.join(env.LOCALAPPDATA || home, "railyard", "state", "model-routing-state.json")
      : path.join(env.XDG_STATE_HOME || path.join(home, ".local", "state"), "railyard", "model-routing-state.json");

  for (const [kind, candidate, overridden] of [["config", configPath, Boolean(configOverride)], ["state", statePath, Boolean(stateOverride)]]) {
    const issue = pathSafetyIssue(candidate, { kind, cwd, platform });
    if (issue) {
      return error(overridden ? "unsafe_override_path" : "unsafe_default_path", { source: kind, detail: issue });
    }
  }
  return result(true, "paths_resolved", {
    config: { path: path.resolve(configPath), source: configOverride ? "config-override" : "config-default" },
    state: { path: path.resolve(statePath), source: stateOverride ? "state-override" : "state-default" },
  });
}

export function safeStat(file) {
  try {
    return fs.lstatSync(file);
  } catch (cause) {
    if (cause?.code === "ENOENT") return null;
    throw cause;
  }
}
