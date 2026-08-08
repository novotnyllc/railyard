/** Frozen contract data: exit codes, thresholds, bounds, schemas, and the closed CLI flag sets. */

export const EXIT_CODES = Object.freeze({
  healthy: 0,
  warning: 1,
  refused: 2,
  failed: 3,
});

export const DEFAULT_THRESHOLDS = Object.freeze({
  fdCount: 200,
  highestFd: 220,
  ageHours: 72,
  descendants: 75,
});

export const SNAPSHOT_SCHEMA = "cleanup-codex-exact-tree-v1";

export const RECYCLE_RECEIPT_SCHEMA = "cleanup-codex-recycle-receipt-v1";

export const RECYCLE_CONFIRMATION_PREFIX = "RECYCLE ";

export const PID_NOFILE_ATTESTATION_SCHEMA = "codex-nofile-attestation-v1";

export const LAUNCHER_NOFILE_ATTESTATION_SCHEMA = "codex-launcher-nofile-attestation-v1";

export const DEFAULT_GRACE_MS = 1_500;

export const DEFAULT_POST_SIGNAL_MS = 100;

export const DEFAULT_MIN_SOFT_NOFILE = 8_192;

export const DEFAULT_READY_TIMEOUT_MS = 10_000;

export const DEFAULT_READY_POLL_MS = 100;

export const MAX_SNAPSHOT_BYTES = 1024 * 1024;

export const MAX_ATTESTATION_BYTES = 64 * 1024;

export const MAX_PID_RECORD_BYTES = 4 * 1024;

export const MAX_HOOK_RECEIPT_BYTES = 64 * 1024;

export const MAX_HOOK_INPUT_BYTES = 16 * 1024;

// ponytail: one bounded SessionEnd pass; chunk only if real residue exceeds the three-second cap.
export const MAX_HOOK_TARGETS = 24;

export const MAX_HOOK_ANCESTORS = 8;

export const HOOK_COMMAND_TIMEOUT_MS = 500;

// Codex clamps SessionEnd hook timeouts to 3s (declaring more just emits a
// discovery warning), so the internal budget leaves ~800ms for node cold
// start and module parse under that hard ceiling.
export const HOOK_TOTAL_BUDGET_MS = 2_200;

// fd 0 arrives as a non-blocking pipe; wait this long for the parent to write
// the payload before giving up. Well inside HOOK_TOTAL_BUDGET_MS.
export const HOOK_STDIN_WAIT_MS = 750;

export const HOOK_STDIN_POLL_MS = 5;

export const HOOK_GRACE_MS = 200;

export const HOOK_POST_SIGNAL_MS = 50;

export const HOOK_RECEIPT_SCHEMA = "cleanup-codex-hook-cleanup-v1";

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const PS = "/bin/ps";

export const LSOF = "/usr/sbin/lsof";

export const PGREP = "/usr/bin/pgrep";

export const SOCKET_NAME = "app-server-control.sock";

export const THRESHOLD_FLAGS = new Map([
  ["--fd-count-warn", "fdCount"],
  ["--highest-fd-warn", "highestFd"],
  ["--age-hours-warn", "ageHours"],
  ["--descendant-warn", "descendants"],
]);

export const CODEX_GLOBAL_VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "--enable",
  "--disable",
  "--remote",
  "--remote-auth-token-env",
  "-m",
  "--model",
  "--local-provider",
  "-p",
  "--profile",
  "-s",
  "--sandbox",
  "--cd",
  "--add-dir",
  "-a",
  "--ask-for-approval",
]);

export const CODEX_GLOBAL_VARIADIC_FLAGS = new Set(["-i", "--image"]);

export const CODEX_GLOBAL_BOOLEAN_FLAGS = new Set([
  "--strict-config",
  "--oss",
  "--dangerously-bypass-approvals-and-sandbox",
  "--dangerously-bypass-hook-trust",
  "--search",
  "--no-alt-screen",
]);

export const APP_SERVER_VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "--enable",
  "--disable",
  "--code-mode-host",
  "--listen",
  "--ws-auth",
  "--ws-token-file",
  "--ws-token-sha256",
  "--ws-shared-secret-file",
  "--ws-issuer",
  "--ws-audience",
  "--ws-max-clock-skew-seconds",
]);

export const APP_SERVER_BOOLEAN_FLAGS = new Set([
  "--strict-config",
  "--stdio",
  "--analytics-default-enabled",
]);
