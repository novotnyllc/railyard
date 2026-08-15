/** Fixed local Daybreak Blue availability discovery for the Codex App Server. */

import {
  spawn,
} from "node:child_process";
import {
  isObject,
} from "./bounds.mjs";

export const DAYBREAK_MODEL = "gpt-daybreak-blue-latest";
export const DAYBREAK_AVAILABILITY_TTL_MS = 24 * 60 * 60 * 1000;
export const APP_SERVER_TIMEOUT_MS = 5_000;
export const MAX_APP_SERVER_RESPONSE_BYTES = 1024 * 1024;
export const MAX_APP_SERVER_MODEL_LIST_PAGES = 16;

export function isSecurityRole(role) {
  return typeof role === "string" && role.startsWith("security.");
}

export function validDaybreakAvailability(value) {
  return value !== undefined
    && value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).length === 2
    && Object.hasOwn(value, "available")
    && Object.hasOwn(value, "checkedAt")
    && [true, false, null].includes(value.available)
    && typeof value.checkedAt === "string"
    && Number.isFinite(Date.parse(value.checkedAt));
}

export function daybreakAvailabilityFresh(value, now = Date.now()) {
  if (!validDaybreakAvailability(value)) return false;
  const checkedAt = Date.parse(value.checkedAt);
  return checkedAt <= now && now - checkedAt < DAYBREAK_AVAILABILITY_TTL_MS;
}

export function daybreakAvailable(value, now = Date.now()) {
  return daybreakAvailabilityFresh(value, now) && value.available === true;
}

export function daybreakListed(value) {
  const models = Array.isArray(value)
    ? value
    : Array.isArray(value?.data)
      ? value.data
      : Array.isArray(value?.models)
        ? value.models
        : [];
  return models.some((model) => model
    && typeof model === "object"
    && model.hidden === false
    && (model.id === DAYBREAK_MODEL || model.model === DAYBREAK_MODEL));
}

/**
 * Ask the App Server only whether its visible model list contains Daybreak.
 * No caller controls the binary, argv, JSON-RPC method, or output retention.
 */
export function probeCodexDaybreak({ spawnProcess = spawn, timeoutMs = APP_SERVER_TIMEOUT_MS } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnProcess("codex", ["app-server", "--stdio"], {
        stdio: ["pipe", "pipe", "ignore"],
        windowsHide: true,
      });
    } catch {
      reject(new Error("app_server_start_failed"));
      return;
    }
    if (!child?.stdin || !child?.stdout || typeof child.on !== "function" || typeof child.stdin.on !== "function" || typeof child.stdout.on !== "function") {
      reject(new Error("app_server_start_failed"));
      return;
    }

    let done = false;
    let stage = "initialize";
    let requestId = 2;
    let pageCount = 0;
    let buffer = "";
    let responseBytes = 0;
    const finish = (cause, value) => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      try { child.stdin.end(); } catch { /* no-op */ }
      if (!child.killed) {
        try { child.kill("SIGTERM"); } catch { /* no-op */ }
      }
      if (cause) reject(cause);
      else resolve(value);
    };
    const send = (id, method, params) => {
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`, (cause) => {
          if (cause) finish(new Error("app_server_write_failed"));
        });
      } catch {
        finish(new Error("app_server_write_failed"));
      }
    };
    const timeout = setTimeout(() => finish(new Error("app_server_timeout")), timeoutMs);

    child.on("error", () => finish(new Error("app_server_start_failed")));
    child.on("exit", (code) => {
      if (!done) finish(new Error(code === 0 ? "app_server_closed" : "app_server_failed"));
    });
    child.stdin.on("error", () => finish(new Error("app_server_write_failed")));
    child.stdout.on("error", () => finish(new Error("app_server_read_failed")));
    child.stdout.on("data", (chunk) => {
      responseBytes += Buffer.byteLength(chunk);
      if (responseBytes > MAX_APP_SERVER_RESPONSE_BYTES) {
        finish(new Error("app_server_response_too_large"));
        return;
      }
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf("\n");
        if (newline < 0) return;
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (!isObject(message)) {
          finish(new Error("app_server_protocol_failed"));
          return;
        }
        if (message.id === 1) {
          if (message.error || !isObject(message.result) || stage !== "initialize") {
            finish(new Error("app_server_initialize_failed"));
            return;
          }
          stage = "model-list";
          send(requestId, "model/list", { includeHidden: false });
        } else if (message.id === requestId) {
          if (message.error || stage !== "model-list" || !Array.isArray(message.result?.data)) {
            finish(new Error("app_server_model_list_failed"));
            return;
          }
          if (daybreakListed(message.result.data)) {
            finish(null, true);
            return;
          }
          pageCount += 1;
          const cursor = message.result.nextCursor;
          if (cursor === undefined || cursor === null) {
            finish(null, false);
            return;
          }
          if (typeof cursor !== "string" || cursor.length === 0 || pageCount >= MAX_APP_SERVER_MODEL_LIST_PAGES) {
            finish(new Error("app_server_model_list_failed"));
            return;
          }
          requestId += 1;
          send(requestId, "model/list", { includeHidden: false, cursor });
        }
      }
    });
    send(1, "initialize", { clientInfo: { name: "railyard-model-routing", version: "v1" }, capabilities: {} });
  });
}

export async function probeDaybreakAvailability({ probe = probeCodexDaybreak } = {}) {
  try {
    return { available: (await probe()) === true };
  } catch {
    return { available: null };
  }
}

export async function refreshDaybreakAvailability(state, { now = Date.now(), probe = probeDaybreakAvailability } = {}) {
  if (daybreakAvailabilityFresh(state.daybreakAvailability, now)) {
    return { changed: false, availability: state.daybreakAvailability };
  }
  let observed;
  try { observed = await probe(); } catch { observed = { available: null }; }
  const availability = [true, false].includes(observed?.available) ? observed.available : null;
  state.daybreakAvailability = { available: availability, checkedAt: new Date(now).toISOString() };
  return { changed: true, availability: state.daybreakAvailability };
}
