import assert from "node:assert/strict";
import { spawn as spawnChild, spawnSync as spawnChildSync } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter, once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildExactTreeSnapshot,
  classifyInventory,
  collectExactProcessIdentity,
  collectMacOSInventory,
  createMutationLock,
  createDefaultRecycleDependencies,
  DEFAULT_THRESHOLDS,
  EXIT_CODES,
  inspectHook,
  parseCliArgs,
  pruneHookReceipts,
  readSnapshotSecure,
  recycleConfirmationToken,
  recycleServer,
  reapSnapshot,
  renderHuman,
  runCli,
  SNAPSHOT_SCHEMA,
  writeSnapshotAtomic,
} from "./cleanup-codex.mjs";

const NOW = Date.parse("2026-08-02T16:00:00.000Z");
const TEST_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIRECTORY = path.resolve(TEST_DIRECTORY, "../../..");

function processRecord(overrides) {
  return {
    pid: 1,
    parentPid: 0,
    processGroupId: 1,
    uid: 501,
    startTime: "2026-08-02T15:00:00.000Z",
    executable: "/sbin/launchd",
    rawCommand: "/sbin/launchd",
    ...overrides,
  };
}

function inventory(overrides = {}) {
  return {
    platform: "darwin",
    collectionErrors: [],
    processes: [],
    descriptors: {},
    proxySockets: {},
    controlSockets: { complete: true, items: [] },
    ...overrides,
  };
}

const EXACT_IDENTITY_FIELDS = [
  "pid",
  "parentPid",
  "processGroupId",
  "uid",
  "startTime",
  "executable",
];

function sameExactIdentity(expected, actual) {
  return Boolean(actual) && EXACT_IDENTITY_FIELDS.every((field) => actual[field] === expected[field]);
}

function guiFixture() {
  return inventory({
    processes: [
      processRecord({
        pid: 10,
        parentPid: 1,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        rawCommand: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      }),
      processRecord({
        pid: 101,
        parentPid: 10,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/Resources/codex",
        rawCommand: "/Applications/ChatGPT.app/Contents/Resources/codex app-server",
      }),
    ],
    descriptors: { 101: { complete: true, count: 20, highest: 31 } },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/codex/app-server-control.sock", ownerPid: 101 }],
    },
  });
}

test("defaults to read-only inspect with stable exit codes", () => {
  assert.deepEqual(parseCliArgs([]), {
    action: "inspect",
    json: false,
    help: false,
    hook: false,
    snapshot: null,
    pid: null,
    confirmation: null,
    unmanaged: false,
    launcher: null,
    nofileAttestor: null,
    minSoftLimit: 8192,
    thresholds: DEFAULT_THRESHOLDS,
    error: null,
  });
  assert.deepEqual(EXIT_CODES, {
    healthy: 0,
    warning: 1,
    refused: 2,
    failed: 3,
  });
});

test("inline CLI values preserve equals signs", () => {
  const parsed = parseCliArgs(["inspect", "--snapshot=/tmp/tree=a.json", "--json"]);

  assert.equal(parsed.snapshot, "/tmp/tree=a.json");
  assert.equal(parsed.error, null);
});

test("separated CLI values never consume a following option", () => {
  const parsed = parseCliArgs(["inspect", "--snapshot", "--json"]);

  assert.equal(parsed.snapshot, null);
  assert.equal(parsed.json, true);
  assert.equal(parsed.error, "invalid-snapshot-argument");
});

test("healthy GUI-only inventory reports no mutation candidate", () => {
  const { result, exitCode } = classifyInventory(guiFixture(), { now: NOW });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(result.action, "inspect");
  assert.equal(result.status, "healthy");
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.skipped, [{ pid: 101, classification: "gui", reasons: ["gui-app-server"] }]);
  assert.equal(result.verification.readOnly, true);
  assert.equal(result.verification.mutationAttempted, false);
  assert.equal(result.verification.servers[0].classification, "gui");
});

test("GUI and detached Unix app-servers are classified separately", () => {
  const fixture = guiFixture();
  fixture.processes.push(
    processRecord({
      pid: 20,
      parentPid: 1,
      processGroupId: 20,
      executable: "/bin/zsh",
      rawCommand: "/bin/zsh",
    }),
    processRecord({
      pid: 202,
      parentPid: 20,
      processGroupId: 202,
      executable: "/usr/local/bin/codex",
      rawCommand: "/usr/local/bin/codex app-server --listen unix:///tmp/detached.sock",
    }),
  );
  fixture.descriptors[202] = { complete: true, count: 18, highest: 25 };
  fixture.controlSockets.items.push({
    path: "/tmp/detached/app-server-control.sock",
    ownerPid: 202,
  });

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });
  const byPid = new Map(result.verification.servers.map((server) => [server.pid, server]));

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(byPid.get(101).classification, "gui");
  assert.equal(byPid.get(202).classification, "detached");
  assert.deepEqual(result.selected, [{
    pid: 202,
    classification: "detached",
    reason: "detached-unix-app-server",
    authorizesMutation: false,
  }]);
  assert.equal(result.skipped[0].pid, 101);
});

test("Codex global options and unix:// identify a detached app-server", () => {
  for (const rawCommand of [
    "/usr/local/bin/codex --strict-config -c features.code_mode_host=true app-server --listen unix://",
    "/usr/local/bin/codex -i /tmp/a.png /tmp/b.png --strict-config app-server --listen unix://",
    "/usr/local/bin/codex --image=/tmp/a.png app-server --listen unix://",
  ]) {
    const fixture = inventory({
      processes: [
        processRecord({ pid: 20, parentPid: 1, processGroupId: 20, rawCommand: "/bin/zsh" }),
        processRecord({
          pid: 202,
          parentPid: 20,
          processGroupId: 202,
          executable: "/usr/local/bin/codex",
          rawCommand,
        }),
      ],
      descriptors: { 202: { complete: true, count: 4, highest: 3 } },
      controlSockets: {
        complete: true,
        items: [{ path: "/tmp/global/app-server-control.sock", ownerPid: 202 }],
      },
    });

    const { result, exitCode } = classifyInventory(fixture, { now: NOW });

    assert.equal(exitCode, EXIT_CODES.healthy, rawCommand);
    assert.equal(result.verification.servers[0].classification, "detached", rawCommand);
    assert.equal(result.selected[0].pid, 202, rawCommand);
  }
});

test("embedded Codex command text does not identify a shell wrapper", () => {
  const fixture = inventory({
    processes: [processRecord({
      pid: 202,
      parentPid: 1,
      processGroupId: 202,
      executable: "/bin/sh",
      rawCommand: "/bin/sh -c /usr/local/bin/codex app-server --listen unix:///tmp/not-codex.sock",
    })],
    descriptors: { 202: { complete: true, count: 4, highest: 3 } },
  });

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(result.selected, []);
  assert.deepEqual(result.verification.servers, []);
});

test("Codex option values and app-server tooling do not identify runtime processes", () => {
  for (const rawCommand of [
    "/usr/local/bin/codex --remote unix:///tmp/app-server-control.sock -m app-server",
    "/usr/local/bin/codex -i app-server --listen unix://",
    "/usr/local/bin/codex -i /tmp/a.png app-server --listen unix://",
    "/usr/local/bin/codex -i --strict-config app-server --listen unix://",
    "/usr/local/bin/codex --image= app-server --listen unix://",
    "/usr/local/bin/codex --image=/tmp/a.png exec app-server --listen unix://",
    "/usr/local/bin/codex exec app-server proxy",
    "/usr/local/bin/codex app-server daemon status",
    "/usr/local/bin/codex app-server generate-json-schema --out /tmp/schema",
    "/usr/local/bin/codex app-server --help",
  ]) {
    const fixture = inventory({
      processes: [processRecord({
        pid: 202,
        parentPid: 1,
        processGroupId: 202,
        executable: "/usr/local/bin/codex",
        rawCommand,
      })],
      descriptors: { 202: { complete: true, count: 4, highest: 3 } },
    });

    const { result } = classifyInventory(fixture, { now: NOW });
    assert.deepEqual(result.verification.servers, [], rawCommand);
  }
});

test("flattened command values cannot authorize selection without exact socket ownership", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 20, parentPid: 1, processGroupId: 20, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 202,
        parentPid: 20,
        processGroupId: 202,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex -c model=x app-server --listen unix://",
      }),
    ],
    descriptors: { 202: { complete: true, count: 4, highest: 3 } },
  });

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.selected, []);
  assert.equal(result.verification.servers[0].classificationReason, "control-socket-unproven");
});

test("command text cannot replace exact control-socket ownership", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 20, parentPid: 1, processGroupId: 20, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 202,
        parentPid: 20,
        processGroupId: 202,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server --config remote=unix:///tmp/not-listen.sock",
      }),
    ],
    descriptors: { 202: { complete: true, count: 4, highest: 3 } },
  });

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(result.verification.servers[0].classification, "ambiguous");
  assert.deepEqual(result.selected, []);
});

test("bare non-GUI app-server identity is ambiguous without owned socket evidence", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 21, parentPid: 1, processGroupId: 21, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 212,
        parentPid: 21,
        processGroupId: 212,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server",
      }),
    ],
    descriptors: { 212: { complete: true, count: 8, highest: 12 } },
    controlSockets: { complete: true, items: [] },
  });

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(result.verification.servers[0].classification, "ambiguous");
  assert.equal(result.verification.servers[0].classificationReason, "control-socket-unproven");
  assert.deepEqual(result.selected, []);
});

test("incomplete process and descriptor evidence refuses classification", () => {
  const fixture = guiFixture();
  fixture.collectionErrors.push({ code: "process-list-incomplete", detail: "ps failed" });
  fixture.descriptors[101] = { complete: false, count: null, highest: null };

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(result.status, "refused");
  assert.deepEqual(result.verification.missingEvidence, ["process-list-incomplete"]);
  assert.ok(result.verification.servers[0].missingEvidence.includes("file-descriptors"));
  assert.equal(result.selected.length, 0);
});

test("process identity requires an absolute executable", () => {
  const fixture = guiFixture();
  fixture.processes[1].executable = "codex";

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.servers[0].missingEvidence.includes("process-identity"));
});

test("pressure thresholds warn but never authorize action", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 30, parentPid: 1, processGroupId: 30, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 303,
        parentPid: 30,
        processGroupId: 303,
        startTime: "2026-08-01T12:00:00.000Z",
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server --listen unix:///tmp/pressure.sock",
      }),
      processRecord({ pid: 304, parentPid: 303, processGroupId: 303, rawCommand: "/usr/bin/worker" }),
      processRecord({ pid: 305, parentPid: 304, processGroupId: 303, rawCommand: "/usr/bin/worker" }),
    ],
    descriptors: { 303: { complete: true, count: 10, highest: 20 } },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/pressure/app-server-control.sock", ownerPid: 303 }],
    },
  });
  const thresholds = { fdCount: 5, highestFd: 15, ageHours: 2, descendants: 1 };

  const { result, exitCode } = classifyInventory(fixture, { now: NOW, thresholds });

  assert.equal(exitCode, EXIT_CODES.warning);
  assert.equal(result.status, "warning");
  assert.deepEqual(
    result.warnings.map((warning) => warning.code).sort(),
    ["age-pressure", "descendant-pressure", "fd-count-pressure", "highest-fd-pressure"],
  );
  assert.ok(result.warnings.every((warning) => warning.authorizesAction === false));
  assert.ok(result.selected.every((candidate) => candidate.authorizesMutation === false));
  assert.equal(result.verification.mutationAttempted, false);
});

test("JSON-safe result omits prompts, transcripts, secrets, and unrelated arguments", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 40, parentPid: 1, processGroupId: 40, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 404,
        parentPid: 40,
        processGroupId: 404,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server --listen unix:///tmp/private.sock --prompt TOP_SECRET --transcript /secret/thread.jsonl --unrelated PRIVATE_VALUE",
      }),
      processRecord({
        pid: 405,
        parentPid: 404,
        processGroupId: 404,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy --token PROXY_SECRET --prompt PRIVATE_PROXY_PROMPT",
      }),
    ],
    descriptors: { 404: { complete: true, count: 8, highest: 12 } },
    proxySockets: {
      405: { complete: true, paths: ["/tmp/private/app-server-control.sock"] },
    },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/private/app-server-control.sock", ownerPid: 404 }],
    },
  });

  const { result } = classifyInventory(fixture, { now: NOW });
  const serialized = JSON.stringify(result);

  assert.deepEqual(Object.keys(result), [
    "schemaVersion",
    "action",
    "status",
    "selected",
    "skipped",
    "warnings",
    "verification",
  ]);
  assert.doesNotMatch(serialized, /TOP_SECRET|PRIVATE_VALUE|PROXY_SECRET|PRIVATE_PROXY_PROMPT/);
  assert.doesNotMatch(serialized, /prompt|transcript|unrelated|--token/);
  assert.deepEqual(result.verification.servers[0].remoteProxyClients, [{
    pid: 405,
    parentPid: 404,
    commandIdentity: "codex app-server proxy",
  }]);
});

test("cross-tree proxy requires an exact lsof match to the server-owned control socket", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 50, parentPid: 1, processGroupId: 50, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 505,
        parentPid: 50,
        processGroupId: 505,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server",
      }),
      processRecord({ pid: 60, parentPid: 1, processGroupId: 60, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 606,
        parentPid: 60,
        processGroupId: 606,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy",
      }),
      processRecord({
        pid: 607,
        parentPid: 60,
        processGroupId: 607,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy",
      }),
    ],
    descriptors: { 505: { complete: true, count: 12, highest: 18 } },
    proxySockets: {
      606: { complete: true, paths: ["/tmp/codex/app-server-control.sock"] },
      607: { complete: true, paths: ["/tmp/other/app-server-control.sock"] },
    },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/codex/app-server-control.sock", ownerPid: 505 }],
    },
  });

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(result.verification.servers[0].remoteProxyClients, [{
    pid: 606,
    parentPid: 60,
    commandIdentity: "codex app-server proxy",
  }]);
  assert.match(renderHuman(result), /remote_proxies=1 pids=606/);
  assert.doesNotMatch(renderHuman(result), /607/);
});

test("socket-name suffixes and path-only evidence cannot authorize a proxy target", () => {
  const socket = "/tmp/codex/app-server-control.sock";
  const fixture = inventory({
    processes: [
      processRecord({ pid: 50, parentPid: 1, processGroupId: 50, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 505,
        parentPid: 50,
        processGroupId: 505,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server",
      }),
      processRecord({
        pid: 606,
        parentPid: 60,
        processGroupId: 606,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy",
      }),
    ],
    descriptors: { 505: { complete: true, count: 12, highest: 18 } },
    proxySockets: {
      606: { complete: true, paths: [`${socket}.old`], connections: [] },
    },
    controlSockets: {
      complete: true,
      items: [{ path: socket, ownerPid: 505, endpoints: ["0x505"] }],
    },
  });

  const { result, exitCode } = classifyInventory(fixture, { now: NOW });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.selected, []);
  assert.ok(result.verification.missingEvidence.includes("proxy-socket-association"));
});

test("macOS collection uses argument-array read-only process calls", () => {
  const calls = [];
  const runner = (file, args) => {
    calls.push({ file, args });
    assert.ok(Array.isArray(args));
    if (file === "/bin/ps" && args.includes("-axo")) {
      return {
        status: 0,
        stdout: [
          "101 1 101 501 Sun Aug 2 10:00:00 2026 /usr/local/bin/codex app-server",
          "202 1 202 501 Sun Aug 2 10:01:00 2026 /usr/local/bin/codex app-server proxy",
          "",
        ].join("\n"),
        stderr: "",
      };
    }
    if (file === "/bin/ps") {
      return {
        status: 0,
        stdout: "101 1 101 501 Sun Aug 2 10:00:00 2026 /usr/local/bin/codex\n",
        stderr: "",
      };
    }
    if (args.includes("-a")) {
      return {
        status: 0,
        stdout: "p101\nftxt\ntREG\nn/usr/local/bin/codex\nf0u\nf7u\n",
        stderr: "",
      };
    }
    return {
      status: 0,
      stdout: "p101\nccodex\nf11u\nd0xdef\nn/tmp/codex/app-server-control.sock\nf12u\nd0x123\nn/tmp/codex/app-server-control.sock\np202\nccodex\nf9u\nd0xabc\nn->0xdef\n",
      stderr: "",
    };
  };

  const collected = collectMacOSInventory({ runner, platform: "darwin" });
  const { result, exitCode } = classifyInventory(collected, { now: NOW });

  assert.equal(collected.processes.length, 2);
  assert.equal(collected.processes[0].executable, "/usr/local/bin/codex");
  assert.deepEqual(collected.descriptors[101], { complete: true, count: 2, highest: 7 });
  assert.deepEqual(collected.proxySockets[202], {
    complete: true,
    paths: [],
    connections: [{ endpoint: "0xabc", peerEndpoint: "0xdef" }],
  });
  assert.deepEqual(collected.controlSockets.items, [{
    path: "/tmp/codex/app-server-control.sock",
    ownerPid: 101,
    endpoints: ["0x123", "0xdef"],
  }]);
  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(result.verification.servers[0].remoteProxyClients, [{
    pid: 202,
    parentPid: 1,
    commandIdentity: "codex app-server proxy",
  }]);
  assert.ok(calls.some(({ file, args }) => file === "/usr/sbin/lsof" && args.includes("-Fftn")));
  assert.equal(calls.filter(({ file }) => file === "/usr/sbin/lsof").length, 2);
  assert.ok(calls.every(({ file }) => file === "/bin/ps" || file === "/usr/sbin/lsof"));
  assert.ok(calls.every(({ args }) => !args.includes("kill") && !args.includes("unlink")));
});

test("process runner errors and signals fail inventory collection closed", () => {
  for (const failure of [
    { error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) },
    { signal: "SIGKILL" },
  ]) {
    const collected = collectMacOSInventory({
      platform: "darwin",
      runner: () => ({
        status: 0,
        stdout: "101 1 101 501 Sun Aug 2 10:00:00 2026 /usr/local/bin/codex app-server\n",
        stderr: "",
        ...failure,
      }),
    });

    assert.deepEqual(collected.processes, []);
    assert.deepEqual(collected.collectionErrors, [{ code: "process-list-unavailable" }]);
  }
});

test("macOS collection rejects prefixed control socket basenames", () => {
  const nearSocket = "/tmp/codex/notapp-server-control.sock";
  const runner = (file, args) => {
    if (file === "/bin/ps" && args.includes("-axo")) {
      return {
        status: 0,
        stdout: "101 1 101 501 Sun Aug 2 10:00:00 2026 /usr/local/bin/codex app-server\n",
        stderr: "",
      };
    }
    if (file === "/bin/ps") {
      return {
        status: 0,
        stdout: "101 1 101 501 Sun Aug 2 10:00:00 2026 /usr/local/bin/codex\n",
        stderr: "",
      };
    }
    if (args.includes("-Fftn")) {
      return {
        status: 0,
        stdout: `p101\nftxt\ntREG\nn/usr/local/bin/codex\nf10u\nn${nearSocket}\n`,
        stderr: "",
      };
    }
    return { status: 0, stdout: `p101\nccodex\nf10u\nn${nearSocket}\n`, stderr: "" };
  };

  const collected = collectMacOSInventory({ runner, platform: "darwin" });
  const { result, exitCode } = classifyInventory(collected, { now: NOW });

  assert.deepEqual(collected.controlSockets.items, []);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.selected, []);
  assert.equal(result.verification.servers[0].controlSocket.state, "not-observed");
  assert.ok(result.verification.servers[0].missingEvidence.includes("gui-detached-classification"));
});

test("macOS collection rejects same-name executables from different generations", () => {
  const replacement = "/opt/other/codex";
  const runner = (file, args) => {
    if (file === "/bin/ps" && args.includes("-axo")) {
      return {
        status: 0,
        stdout: "101 1 101 501 Sun Aug 2 10:00:00 2026 /usr/local/bin/codex app-server --listen unix:///tmp/runtime.sock\n",
        stderr: "",
      };
    }
    if (file === "/bin/ps") {
      return {
        status: 0,
        stdout: `101 1 101 501 Sun Aug 2 10:00:00 2026 ${replacement}\n`,
        stderr: "",
      };
    }
    if (args.includes("-Fftn")) {
      return { status: 0, stdout: `p101\nftxt\ntREG\nn${replacement}\nf0u\n`, stderr: "" };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  const collected = collectMacOSInventory({ runner, platform: "darwin" });
  const { result, exitCode } = classifyInventory(collected, { now: NOW });

  assert.equal(collected.processes[0].identityComplete, false);
  assert.equal(collected.processes[0].executable, null);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.selected, []);
});

test("macOS collection binds a relative Codex command to exact ps and lsof evidence", () => {
  const executable = "/opt/codex/bin/codex";
  const runner = (file, args) => {
    if (file === "/bin/ps" && args.includes("-axo")) {
      return {
        status: 0,
        stdout: "101 1 101 501 Sun Aug 2 10:00:00 2026 codex -c features.code_mode_host=true app-server --listen unix://\n",
        stderr: "",
      };
    }
    if (file === "/bin/ps") {
      return {
        status: 0,
        stdout: `101 1 101 501 Sun Aug 2 10:00:00 2026 ${executable}\n`,
        stderr: "",
      };
    }
    if (args.includes("-Fftn")) {
      return { status: 0, stdout: `p101\nftxt\ntREG\nn${executable}\nf0u\n`, stderr: "" };
    }
    if (args.includes("-U")) {
      return {
        status: 0,
        stdout: "p101\nccodex\nf10u\nn/tmp/relative/app-server-control.sock\n",
        stderr: "",
      };
    }
    return { status: 0, stdout: "", stderr: "" };
  };

  const collected = collectMacOSInventory({ runner, platform: "darwin" });
  const { result, exitCode } = classifyInventory(collected, { now: NOW });

  assert.equal(collected.processes[0].identityComplete, true);
  assert.equal(collected.processes[0].executable, executable);
  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(result.selected[0].pid, 101);
});

test("exact process identity refuses PID churn across ps and lsof", () => {
  let psCalls = 0;
  const runner = (file) => {
    if (file === "/bin/ps") {
      psCalls += 1;
      return {
        status: 0,
        stdout: psCalls === 1
          ? "101 1 101 501 Sun Aug 2 10:00:00 2026 /usr/local/bin/codex\n"
          : "101 9 101 501 Sun Aug 2 10:00:01 2026 /usr/local/bin/codex\n",
        stderr: "",
      };
    }
    return {
      status: 0,
      stdout: "p101\nftxt\ntREG\nn/usr/local/bin/codex\n",
      stderr: "",
    };
  };

  assert.deepEqual(collectExactProcessIdentity(101, { runner }), { state: "unknown" });
  assert.equal(psCalls, 2);
});

function exactIdentity(overrides = {}) {
  return {
    pid: 200,
    parentPid: 100,
    processGroupId: 100,
    uid: 501,
    startTime: "2026-08-02T15:30:00.000Z",
    executable: "/usr/bin/worker",
    ...overrides,
  };
}

function snapshotFixture(overrides = {}) {
  return {
    schema: SNAPSHOT_SCHEMA,
    createdAt: "2026-08-02T16:00:00.000Z",
    createdByUid: 501,
    owner: {
      role: "server",
      ...exactIdentity({
        pid: 100,
        parentPid: 1,
        processGroupId: 100,
        startTime: "2026-08-02T15:00:00.000Z",
        executable: "/usr/local/bin/codex",
        commandIdentity: "codex app-server",
      }),
    },
    targets: [{
      role: "descendant",
      ...exactIdentity({ commandIdentity: "process" }),
    }],
    ...overrides,
  };
}

function sequenceReader(sequences) {
  const calls = [];
  return {
    calls,
    readIdentity(pid) {
      calls.push(pid);
      const values = sequences.get(pid);
      assert.ok(values?.length, `unexpected identity read for pid ${pid}`);
      return values.shift();
    },
  };
}

function unlocked() {
  return {
    acquire() {
      return () => {};
    },
  };
}

test("inspect snapshot records only the exact selected tree and socket-linked proxy", () => {
  const fixture = inventory({
    processes: [
      processRecord({ pid: 50, parentPid: 1, processGroupId: 50, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 500,
        parentPid: 50,
        processGroupId: 500,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server --prompt SNAPSHOT_SECRET",
      }),
      processRecord({
        pid: 501,
        parentPid: 500,
        processGroupId: 500,
        executable: "/usr/bin/worker",
        rawCommand: "/usr/bin/worker --transcript PRIVATE_TRANSCRIPT",
      }),
      processRecord({
        pid: 502,
        parentPid: 500,
        processGroupId: 500,
        executable: "/usr/local/bin/cloudflared",
        rawCommand: "/usr/local/bin/cloudflared tunnel run",
      }),
      processRecord({ pid: 60, parentPid: 1, processGroupId: 60, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 600,
        parentPid: 60,
        processGroupId: 600,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy --token PROXY_SECRET",
      }),
      processRecord({
        pid: 601,
        parentPid: 60,
        processGroupId: 601,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy",
      }),
      processRecord({ pid: 700, parentPid: 1, processGroupId: 700, rawCommand: "/usr/bin/unrelated" }),
    ],
    descriptors: { 500: { complete: true, count: 12, highest: 18 } },
    proxySockets: {
      600: {
        complete: true,
        paths: ["/tmp/codex/app-server-control.sock"],
        connections: [{ endpoint: "0x600", peerEndpoint: "0x500" }],
      },
      601: { complete: true, paths: ["/tmp/other/app-server-control.sock"] },
    },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/codex/app-server-control.sock", ownerPid: 500, endpoints: ["0x500"] }],
    },
  });
  const { result } = classifyInventory(fixture, { now: NOW });
  const exact = new Map([
    [500, exactIdentity({
      pid: 500,
      parentPid: 50,
      processGroupId: 500,
      startTime: fixture.processes[1].startTime,
      executable: "/usr/local/bin/codex",
    })],
    [501, exactIdentity({
      pid: 501,
      parentPid: 500,
      processGroupId: 500,
      startTime: fixture.processes[2].startTime,
    })],
    [502, exactIdentity({
      pid: 502,
      parentPid: 500,
      processGroupId: 500,
      startTime: fixture.processes[3].startTime,
      executable: "/usr/local/bin/cloudflared",
    })],
    [600, exactIdentity({
      pid: 600,
      parentPid: 60,
      processGroupId: 600,
      startTime: fixture.processes[5].startTime,
      executable: "/usr/local/bin/codex",
    })],
  ]);

  const snapshot = buildExactTreeSnapshot({
    inventory: fixture,
    inspection: result,
    readIdentity: (pid) => ({ state: "present", identity: exact.get(pid) }),
    now: NOW,
    uid: 501,
  });

  assert.equal(snapshot.owner.pid, 500);
  assert.deepEqual(snapshot.targets.map(({ pid, role }) => ({ pid, role })), [
    { pid: 501, role: "descendant" },
    { pid: 502, role: "descendant" },
    { pid: 600, role: "proxy" },
  ]);
  assert.doesNotMatch(JSON.stringify(snapshot), /SNAPSHOT_SECRET|PRIVATE_TRANSCRIPT|PROXY_SECRET|prompt|transcript|token/);
});

test("inspect --snapshot atomically writes a private validated snapshot", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-snapshot-"));
  const snapshotPath = path.join(directory, "tree.json");
  const fixture = inventory({
    processes: [
      processRecord({ pid: 70, parentPid: 1, processGroupId: 70, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 707,
        parentPid: 70,
        processGroupId: 707,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server --listen unix:///tmp/runtime.sock",
      }),
    ],
    descriptors: { 707: { complete: true, count: 10, highest: 16 } },
    controlSockets: {
      complete: true,
      items: [{ path: "/tmp/runtime/app-server-control.sock", ownerPid: 707 }],
    },
  });
  const output = [];
  try {
    const exitCode = runCli(["inspect", "--snapshot", snapshotPath, "--json"], {
      platform: "darwin",
      now: NOW,
      uid: process.getuid(),
      inventory: fixture,
      readIdentity: () => ({ state: "present", identity: exactIdentity({
        pid: 707,
        parentPid: 70,
        processGroupId: 707,
        uid: process.getuid(),
        startTime: fixture.processes[1].startTime,
        executable: "/usr/local/bin/codex",
      }) }),
      write: (text) => output.push(text),
    });

    assert.equal(exitCode, EXIT_CODES.healthy);
    assert.equal(fs.lstatSync(snapshotPath).mode & 0o777, 0o600);
    assert.equal(JSON.parse(output[0]).verification.snapshot.created, true);
    assert.doesNotMatch(output[0], new RegExp(snapshotPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(readSnapshotSecure(snapshotPath, { uid: process.getuid() }).owner.pid, 707);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("snapshot file validation rejects overwrite, bad schema, mode, owner, and symlink", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-safety-"));
  const uid = process.getuid();
  const valid = snapshotFixture({
    createdByUid: uid,
    owner: { ...snapshotFixture().owner, uid },
    targets: snapshotFixture().targets.map((target) => ({ ...target, uid })),
  });
  try {
    const safe = path.join(directory, "safe.json");
    writeSnapshotAtomic(safe, valid, { uid });
    assert.deepEqual(readSnapshotSecure(safe, { uid }), valid);
    assert.throws(() => writeSnapshotAtomic(safe, valid, { uid }), (error) => error.code === "snapshot-file-exists");

    const badSchema = path.join(directory, "bad-schema.json");
    fs.writeFileSync(badSchema, JSON.stringify({ ...valid, prompt: "SECRET" }), { mode: 0o600 });
    assert.throws(() => readSnapshotSecure(badSchema, { uid }), (error) => error.code === "snapshot-schema-invalid");

    const badMode = path.join(directory, "bad-mode.json");
    fs.writeFileSync(badMode, JSON.stringify(valid), { mode: 0o644 });
    fs.chmodSync(badMode, 0o644);
    assert.throws(() => readSnapshotSecure(badMode, { uid }), (error) => error.code === "snapshot-file-mode");
    assert.throws(() => readSnapshotSecure(safe, { uid: uid + 1 }), (error) => error.code === "snapshot-file-owner");

    const link = path.join(directory, "snapshot-link.json");
    fs.symlinkSync(safe, link);
    assert.throws(() => readSnapshotSecure(link, { uid }), (error) => error.code === "snapshot-file-symlink");

    const oversized = path.join(directory, "oversized.json");
    const tooLarge = {
      ...valid,
      targets: Array.from({ length: 10_000 }, (_, index) => ({
        ...valid.targets[0],
        role: "proxy",
        commandIdentity: "codex app-server proxy",
        pid: 10_000 + index,
        parentPid: 1,
      })),
    };
    assert.throws(
      () => writeSnapshotAtomic(oversized, tooLarge, { uid }),
      (error) => error.code === "snapshot-file-size",
    );
    assert.equal(fs.existsSync(oversized), false);

    const rejectedPublication = path.join(directory, "rejected-publication.json");
    let linked = false;
    let rejectFinalCheck = true;
    const failingFs = {
      ...fs,
      openSync(file, flags) {
        return fs.openSync(file, flags, 0o000);
      },
      linkSync(source, destination) {
        fs.linkSync(source, destination);
        linked = true;
      },
      lstatSync(file) {
        if (file === rejectedPublication && linked && rejectFinalCheck) {
          rejectFinalCheck = false;
          throw Object.assign(new Error("injected final check failure"), { code: "EIO" });
        }
        return fs.lstatSync(file);
      },
    };
    assert.throws(
      () => writeSnapshotAtomic(rejectedPublication, valid, { fsApi: failingFs, uid }),
      (error) => error.code === "snapshot-write-failed",
    );
    assert.equal(fs.existsSync(rejectedPublication), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("reap refuses while the exact recorded owner is live", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "present", identity: snapshot.owner }]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => assert.fail("must not sleep"),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(signals, []);
  assert.deepEqual(result.verification.missingEvidence, ["owner-still-live"]);
  assert.deepEqual(reader.calls, [100]);
});

test("reap does not treat a reused owner PID as conclusive absence", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{
      state: "present",
      identity: { ...snapshot.owner, startTime: "2026-08-02T15:01:00.000Z" },
    }]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => assert.fail("must not sleep"),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(signals, []);
  assert.deepEqual(result.verification.missingEvidence, ["owner-identity-changed"]);
});

test("reap refuses PID reuse and every required identity drift without signaling", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const changes = new Map([
    ["pid", target.pid + 1],
    ["uid", target.uid + 1],
    ["startTime", "2026-08-02T15:31:00.000Z"],
    ["executable", "/usr/bin/replacement"],
    ["processGroupId", target.processGroupId + 1],
  ]);

  for (const [field, value] of changes) {
    const signals = [];
    const reader = sequenceReader(new Map([
      [100, [{ state: "absent" }]],
      [200, [{ state: "present", identity: { ...target, [field]: value } }]],
    ]));
    const { result, exitCode } = reapSnapshot(snapshot, {
      platform: "darwin",
      uid: 501,
      readIdentity: reader.readIdentity,
      signalProcess: (...args) => signals.push(args),
      sleep: () => assert.fail("must not sleep"),
      lock: unlocked(),
    });

    assert.equal(exitCode, EXIT_CODES.refused, field);
    assert.deepEqual(signals, [], field);
    assert.ok(result.skipped[0].reasons.includes(`identity-changed:${field}`), field);
  }
});

test("TERM-responsive target is never KILLed", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const sleeps = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: snapshot.targets[0] },
      { state: "present", identity: snapshot.targets[0] },
      { state: "absent" },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: (milliseconds) => sleeps.push(milliseconds),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.deepEqual(sleeps, [1500]);
  assert.deepEqual(result.verification.termPids, [200]);
  assert.deepEqual(result.verification.killPids, []);
});

test("TERM-resistant matching survivor is KILLed and a later child is untouched", () => {
  const snapshot = snapshotFixture();
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: snapshot.targets[0] },
      { state: "present", identity: snapshot.targets[0] },
      { state: "present", identity: snapshot.targets[0] },
      { state: "absent" },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
  assert.deepEqual(reader.calls, [100, 200, 200, 200, 200]);
  assert.deepEqual(result.verification.killPids, [200]);
  assert.ok(signals.every(([pid]) => pid !== 300));
});

test("identity drift after TERM prevents survivor KILL", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, executable: "/usr/bin/replacement" } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.deepEqual(result.verification.killPids, []);
  assert.equal(result.verification.complete, false);
  assert.ok(result.skipped[0].reasons.includes("identity-changed:executable"));
});

test("UID drift after TERM does not prove PID reuse", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, uid: target.uid + 1 } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.equal(result.verification.postKillVerifiedPids.includes(200), false);
  assert.ok(result.skipped[0].reasons.includes("identity-changed:uid"));
});

test("PID reuse after TERM proves the old identity gone without KILL", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, startTime: "2026-08-02T15:31:00.000Z" } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"]]);
  assert.deepEqual(result.verification.postKillVerifiedPids, [200]);
  assert.ok(result.skipped.some((item) => (
    item.pid === 200 && item.reasons.includes("pid-reused-after-term")
  )));
});

test("exact survivor lingering after SIGKILL returns incomplete exit 3", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const sleeps = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: (milliseconds) => sleeps.push(milliseconds),
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.equal(result.verification.complete, false);
  assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
  assert.deepEqual(sleeps, [1500, 100]);
  assert.ok(result.verification.missingEvidence.includes("post-kill-survivor"));
});

test("same-start drift after SIGKILL remains a survivor", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  for (const drift of [{ processGroupId: 777 }, { uid: target.uid + 1 }]) {
    const signals = [];
    const reader = sequenceReader(new Map([
      [100, [{ state: "absent" }]],
      [200, [
        { state: "present", identity: target },
        { state: "present", identity: target },
        { state: "present", identity: target },
        { state: "present", identity: { ...target, ...drift } },
      ]],
    ]));

    const { result, exitCode } = reapSnapshot(snapshot, {
      platform: "darwin",
      uid: 501,
      readIdentity: reader.readIdentity,
      signalProcess: (...args) => signals.push(args),
      sleep: () => {},
      lock: unlocked(),
    });

    assert.equal(exitCode, EXIT_CODES.failed);
    assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
    assert.ok(result.verification.missingEvidence.includes("post-kill-survivor"));
    assert.equal(result.verification.postKillVerifiedPids.includes(200), false);
  }
});

test("unknown final state after SIGKILL returns incomplete exit 3", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "unknown" },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: () => {},
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.failed);
  assert.ok(result.verification.missingEvidence.includes("post-kill-verification-unknown"));
});

test("reused PID after SIGKILL proves the old identity gone without another signal", () => {
  const snapshot = snapshotFixture();
  const target = snapshot.targets[0];
  const signals = [];
  const reader = sequenceReader(new Map([
    [100, [{ state: "absent" }]],
    [200, [
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: target },
      { state: "present", identity: { ...target, startTime: "2026-08-02T15:31:00.000Z" } },
    ]],
  ]));

  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: reader.readIdentity,
    signalProcess: (...args) => signals.push(args),
    sleep: () => {},
    lock: unlocked(),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.deepEqual(signals, [[200, "SIGTERM"], [200, "SIGKILL"]]);
  assert.deepEqual(result.verification.postKillVerifiedPids, [200]);
  assert.ok(result.skipped.some((item) => item.pid === 200 && item.reasons.includes("pid-reused-after-kill")));
});

test("reap refuses lock contention before process inspection", () => {
  const snapshot = snapshotFixture();
  let inspected = false;
  const { result, exitCode } = reapSnapshot(snapshot, {
    platform: "darwin",
    uid: 501,
    readIdentity: () => {
      inspected = true;
      return { state: "absent" };
    },
    signalProcess: () => assert.fail("must not signal"),
    sleep: () => assert.fail("must not sleep"),
    lock: {
      acquire() {
        const error = new Error("held");
        error.code = "ELOCKED";
        throw error;
      },
    },
  });

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(inspected, false);
  assert.deepEqual(result.verification.missingEvidence, ["mutation-lock-held"]);
});

test("filesystem mutation lock is exclusive and reusable", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-"));
  const lockPath = path.join(directory, "mutation.lock");
  try {
    const first = createMutationLock({ uid: process.getuid(), lockPath });
    const second = createMutationLock({ uid: process.getuid(), lockPath });
    const release = first.acquire();

    assert.throws(() => second.acquire(), (error) => error.code === "mutation-lock-held");
    release();
    second.acquire()();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("filesystem mutation lock reclaims only a private lock whose owner is absent", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-stale-"));
  const lockPath = path.join(directory, "mutation.lock");
  try {
    fs.writeFileSync(lockPath, `${JSON.stringify({ pid: 999_999, uid: process.getuid() })}\n`, { mode: 0o600 });
    const release = createMutationLock({
      uid: process.getuid(),
      lockPath,
      pidIsAlive: (pid) => pid !== 999_999,
    }).acquire();
    assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).pid, process.pid);
    release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("filesystem mutation lock reclaims a birth-bound lock after PID reuse", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-reused-"));
  const lockPath = path.join(directory, "mutation.lock");
  const oldStartTime = "2026-08-02T12:00:00.000Z";
  const currentStartTime = "2026-08-03T12:00:00.000Z";
  try {
    fs.writeFileSync(lockPath, `${JSON.stringify({
      pid: 999_999,
      uid: process.getuid(),
      startTime: oldStartTime,
    })}\n`, { mode: 0o600 });
    const release = createMutationLock({
      uid: process.getuid(),
      lockPath,
      readProcessBirth: (pid) => ({
        state: "present",
        uid: process.getuid(),
        startTime: pid === process.pid ? currentStartTime : "2026-08-02T13:00:00.000Z",
      }),
    }).acquire();
    assert.equal(JSON.parse(fs.readFileSync(lockPath, "utf8")).startTime, currentStartTime);
    release();
    assert.equal(fs.existsSync(lockPath), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("lock release preserves a replacement across an inode swap", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-swap-"));
  const lockPath = path.join(directory, "mutation.lock");
  const originalPath = path.join(directory, "original.lock");
  let swap = false;
  const fsApi = {
    ...fs,
    lstatSync(file) {
      if (file === lockPath && swap) {
        swap = false;
        const original = fs.lstatSync(file);
        fs.renameSync(file, originalPath);
        fs.writeFileSync(file, "replacement\n", { mode: 0o600 });
        return original;
      }
      return fs.lstatSync(file);
    },
  };
  try {
    const release = createMutationLock({ fsApi, uid: process.getuid(), lockPath }).acquire();
    swap = true;

    assert.throws(release, (error) => error.code === "mutation-lock-changed");
    assert.equal(fs.readFileSync(lockPath, "utf8"), "replacement\n");
    assert.equal(fs.existsSync(originalPath), true);
    assert.deepEqual(
      fs.readdirSync(directory).sort(),
      [path.basename(lockPath), path.basename(originalPath)].sort(),
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("failed lock initialization removes only its created inode", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-lock-failure-"));
  const lockPath = path.join(directory, "mutation.lock");
  const failingFs = {
    ...fs,
    openSync(file, flags) {
      return fs.openSync(file, flags, 0o000);
    },
    writeFileSync(target, ...args) {
      if (typeof target === "number") {
        throw Object.assign(new Error("injected lock write failure"), { code: "EIO" });
      }
      return fs.writeFileSync(target, ...args);
    },
  };
  try {
    assert.throws(
      () => createMutationLock({ fsApi: failingFs, uid: process.getuid(), lockPath }).acquire(),
      (error) => error.code === "mutation-lock-unavailable",
    );
    assert.equal(fs.existsSync(lockPath), false);
    createMutationLock({ uid: process.getuid(), lockPath }).acquire()();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const RECYCLE_SOCKET = "/tmp/codex/app-server-control.sock";
const GUI_SOCKET = "/tmp/codex-gui/app-server-control.sock";
const ATTESTOR = "/usr/local/bin/codex-nofile-attestor";
const LAUNCHER = "/usr/local/bin/codex-wrapper";

function recycleInventoryFixture() {
  return inventory({
    processes: [
      processRecord({
        pid: 10,
        parentPid: 1,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
        rawCommand: "/Applications/ChatGPT.app/Contents/MacOS/ChatGPT",
      }),
      processRecord({
        pid: 101,
        parentPid: 10,
        processGroupId: 10,
        executable: "/Applications/ChatGPT.app/Contents/Resources/codex",
        rawCommand: "/Applications/ChatGPT.app/Contents/Resources/codex app-server",
      }),
      processRecord({ pid: 50, parentPid: 1, processGroupId: 50, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 500,
        parentPid: 50,
        processGroupId: 500,
        executable: "/usr/local/bin/codex",
        rawCommand: `/usr/local/bin/codex app-server --listen unix://${RECYCLE_SOCKET}`,
      }),
      processRecord({
        pid: 501,
        parentPid: 500,
        processGroupId: 500,
        executable: "/usr/bin/worker",
        rawCommand: "/usr/bin/worker --prompt SHOULD_NOT_LEAK",
      }),
      processRecord({ pid: 60, parentPid: 1, processGroupId: 60, rawCommand: "/bin/zsh" }),
      processRecord({
        pid: 600,
        parentPid: 60,
        processGroupId: 600,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy --token PROXY_SECRET",
      }),
      processRecord({
        pid: 601,
        parentPid: 60,
        processGroupId: 601,
        executable: "/usr/local/bin/codex",
        rawCommand: "/usr/local/bin/codex app-server proxy",
      }),
    ],
    descriptors: {
      101: { complete: true, count: 25, highest: 46 },
      500: { complete: true, count: 255, highest: 255 },
    },
    proxySockets: {
      600: {
        complete: true,
        paths: [RECYCLE_SOCKET],
        connections: [{ endpoint: "0x600", peerEndpoint: "0x500" }],
      },
      601: { complete: true, paths: ["/tmp/other/app-server-control.sock"] },
    },
    controlSockets: {
      complete: true,
      items: [
        { path: GUI_SOCKET, ownerPid: 101 },
        { path: RECYCLE_SOCKET, ownerPid: 500, endpoints: ["0x500"] },
      ],
    },
  });
}

function liveIdentity(record, overrides = {}) {
  return exactIdentity({
    pid: record.pid,
    parentPid: record.parentPid,
    processGroupId: record.processGroupId,
    uid: record.uid,
    startTime: record.startTime,
    executable: record.executable,
    ...overrides,
  });
}

function daemonSample(fixture, backend = "pid", overrides = {}) {
  const server = fixture.processes.find((item) => item.pid === 500);
  return {
    version: {
      status: "running",
      backend,
      socketPath: RECYCLE_SOCKET,
      managedCodexPath: backend === "pid" ? "/usr/local/bin/codex" : null,
    },
    socketOwners: [{ pid: 500, uid: 501 }],
    managedExecutable: backend === "pid"
      ? { path: "/usr/local/bin/codex", dev: 1, ino: 2 }
      : null,
    pidRecord: backend === "pid"
      ? {
          state: "valid",
          uid: 501,
          regular: true,
          symlink: false,
          pid: 500,
          processStartTime: server.startTime,
        }
      : { state: "absent" },
    ...overrides,
  };
}

function recycleOptions(overrides = {}) {
  return {
    platform: "darwin",
    uid: 501,
    pid: 500,
    unmanaged: false,
    confirmation: null,
    attestorPath: ATTESTOR,
    minSoftLimit: 8192,
    launcher: null,
    ...overrides,
  };
}

function recycleHarness({
  mode = "managed",
  sampleOverrides = [],
  ready = undefined,
  oldSoftNofile = 8192,
} = {}) {
  const fixture = recycleInventoryFixture();
  const byPid = new Map(fixture.processes.map((record) => [record.pid, record]));
  const state = new Map([
    [101, { state: "present", identity: liveIdentity(byPid.get(101)) }],
    [500, { state: "present", identity: liveIdentity(byPid.get(500)) }],
    [501, { state: "present", identity: liveIdentity(byPid.get(501)) }],
    [600, { state: "present", identity: liveIdentity(byPid.get(600)) }],
  ]);
  const replacement = exactIdentity({
    pid: 900,
    parentPid: 1,
    processGroupId: 900,
    uid: 501,
    startTime: "2026-08-02T16:01:00.000Z",
    executable: "/usr/local/bin/codex",
  });
  const baseSample = daemonSample(fixture, mode === "managed" ? "pid" : null);
  const replacementSample = daemonSample(fixture, mode === "managed" ? "pid" : null, {
    socketOwners: [{ pid: replacement.pid, uid: replacement.uid }],
    pidRecord: mode === "managed"
      ? {
          state: "valid",
          uid: replacement.uid,
          regular: true,
          symlink: false,
          pid: replacement.pid,
          processStartTime: replacement.startTime,
        }
      : { state: "absent" },
  });
  const samples = sampleOverrides.length
    ? sampleOverrides
    : [baseSample, baseSample, baseSample, baseSample, replacementSample];
  let sampleIndex = 0;
  const calls = {
    samples: 0,
    sampleContexts: [],
    attest: [],
    attestLauncher: [],
    restart: 0,
    residue: 0,
    stop: 0,
    launch: 0,
    lock: 0,
    readyContext: null,
  };
  const deps = {
    inventory: fixture,
    collectInventory() {
      return fixture;
    },
    readIdentity(pid) {
      return state.get(pid) ?? { state: "absent" };
    },
    canonicalPath(value) {
      return value;
    },
    fileIdentity(value) {
      if (!["/usr/local/bin/codex", ATTESTOR, LAUNCHER].includes(value)) return null;
      return {
        path: value,
        dev: value === "/usr/local/bin/codex" ? 1 : 3,
        ino: value === "/usr/local/bin/codex" ? 2 : value === ATTESTOR ? 4 : 5,
        uid: 0,
        mode: 0o100755,
        nlink: 1,
        mtimeMs: 1,
        size: 100,
        digest: value === "/usr/local/bin/codex" ? "a".repeat(64) : value === ATTESTOR ? "b".repeat(64) : "c".repeat(64),
        regular: true,
        symlink: false,
        executable: true,
      };
    },
    sampleDaemonEvidence(context) {
      calls.samples += 1;
      calls.sampleContexts.push(context);
      return structuredClone(samples[Math.min(sampleIndex++, samples.length - 1)]);
    },
    attestNofile(identity) {
      calls.attest.push(identity.pid);
      return {
        schema: "codex-nofile-attestation-v1",
        pid: identity.pid,
        uid: identity.uid,
        processStartTime: identity.startTime,
        softNofile: identity.pid === 500 ? oldSoftNofile : 8192,
      };
    },
    attestLauncher(launcher) {
      calls.attestLauncher.push(launcher.path);
      return {
        schema: "codex-launcher-nofile-attestation-v1",
        path: launcher.path,
        dev: launcher.dev,
        ino: launcher.ino,
        replacementExecutable: "/usr/local/bin/codex",
        softNofile: 8192,
      };
    },
    restartManagedExact({ expectedIdentity }) {
      assert.equal(expectedIdentity.pid, 500);
      assert.equal(expectedIdentity.startTime, fixture.processes.find((item) => item.pid === 500).startTime);
      calls.restart += 1;
      state.set(500, { state: "absent" });
      state.set(900, { state: "present", identity: replacement });
      return {
        status: "restarted",
        backend: "pid",
        pid: 900,
        socketPath: RECYCLE_SOCKET,
      };
    },
    reapResidue(snapshot) {
      calls.residue += 1;
      for (const target of snapshot.targets) state.set(target.pid, { state: "absent" });
      return { exitCode: EXIT_CODES.healthy };
    },
    stopUnmanaged(snapshot) {
      calls.stop += 1;
      state.set(snapshot.owner.pid, { state: "absent" });
      for (const target of snapshot.targets) state.set(target.pid, { state: "absent" });
      return { exitCode: EXIT_CODES.healthy };
    },
    launchUnmanaged() {
      calls.launch += 1;
      state.set(900, { state: "present", identity: replacement });
      return { pid: 900 };
    },
    waitForReady(context) {
      calls.readyContext = context;
      return ready === undefined
        ? {
            identity: replacement,
            socket: { path: RECYCLE_SOCKET, ready: true, owners: [{ pid: 900, uid: 501 }] },
            descriptors: { count: 122, highest: 145 },
            directChildren: 19,
          }
        : ready;
    },
    lock: {
      acquire() {
        calls.lock += 1;
        return () => {};
      },
    },
  };
  return { fixture, state, replacement, calls, deps };
}

function confirmedRecycleOptions(overrides = {}, harnessOptions = {}) {
  const base = recycleOptions(overrides);
  const probe = recycleHarness({
    mode: base.unmanaged ? "unmanaged" : "managed",
    ...harnessOptions,
  });
  const { result } = recycleServer({ ...base, confirmation: null }, probe.deps);
  assert.ok(result.verification.receipt?.confirmationToken);
  return { ...base, confirmation: result.verification.receipt.confirmationToken };
}

function addApplicableParent(harness) {
  const parent = harness.fixture.processes.find((item) => item.pid === 50);
  parent.executable = "/usr/local/bin/codex";
  parent.rawCommand = "/usr/local/bin/codex launcher";
  harness.state.set(parent.pid, { state: "present", identity: liveIdentity(parent) });
  return parent;
}

function parentBoundOptions() {
  const probe = recycleHarness();
  addApplicableParent(probe);
  const options = recycleOptions();
  const { result } = recycleServer(options, probe.deps);
  assert.ok(result.verification.receipt?.confirmationToken);
  return { ...options, confirmation: result.verification.receipt.confirmationToken };
}

test("recycle rejects GUI, editor, and ambiguous selections", () => {
  const gui = recycleHarness();
  assert.equal(recycleServer(recycleOptions({ pid: 101 }), gui.deps).exitCode, EXIT_CODES.refused);
  assert.equal(recycleServer(recycleOptions({ pid: 10 }), recycleHarness().deps).exitCode, EXIT_CODES.refused);

  const ambiguous = recycleHarness();
  const server = ambiguous.fixture.processes.find((item) => item.pid === 500);
  server.rawCommand = "/usr/local/bin/codex app-server";
  ambiguous.fixture.controlSockets.items = ambiguous.fixture.controlSockets.items.filter((item) => item.ownerPid !== 500);
  assert.equal(recycleServer(recycleOptions(), ambiguous.deps).exitCode, EXIT_CODES.refused);
  assert.equal(ambiguous.calls.restart, 0);
});

test("recycle receipt names the exact tree and requires its confirmation token", () => {
  const harness = recycleHarness();
  const { result, exitCode } = recycleServer(recycleOptions({ confirmation: null }), harness.deps);

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.verification.receipt.selectedPids, [500, 501, 600]);
  const { confirmationToken, digest, ...receiptCore } = result.verification.receipt;
  assert.equal(confirmationToken, recycleConfirmationToken(receiptCore));
  assert.equal(digest, confirmationToken.slice("RECYCLE ".length));
  assert.equal(result.verification.mutationAttempted, false);
  assert.doesNotMatch(JSON.stringify(result), /SHOULD_NOT_LEAK|PROXY_SECRET|prompt|--token/);
  assert.equal(harness.calls.samples, 2);
});

test("unclassified proxy and reused proxy identity refuse before mutation", () => {
  const unclassified = recycleHarness();
  unclassified.fixture.processes.push(processRecord({
    pid: 602,
    parentPid: 60,
    processGroupId: 602,
    executable: "/usr/local/bin/codex",
    rawCommand: "/usr/local/bin/codex app-server proxy",
  }));
  unclassified.fixture.proxySockets[602] = { complete: false, paths: [] };
  assert.equal(recycleServer(recycleOptions(), unclassified.deps).exitCode, EXIT_CODES.refused);
  assert.equal(unclassified.calls.restart, 0);

  const reused = recycleHarness();
  const originalRead = reused.deps.readIdentity;
  reused.deps.readIdentity = (pid) => pid === 600
    ? { state: "present", identity: liveIdentity(reused.fixture.processes.find((item) => item.pid === 600), {
        startTime: "2026-08-02T15:01:00.000Z",
      }) }
    : originalRead(pid);
  assert.equal(recycleServer(recycleOptions(), reused.deps).exitCode, EXIT_CODES.refused);
  assert.equal(reused.calls.restart, 0);
});

test("managed recycle requires four stable exact pre-mutation samples and never signals the server", () => {
  const harness = recycleHarness();
  const { result, exitCode } = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(harness.calls.samples, 5);
  assert.ok(harness.calls.sampleContexts.every((context) => (
    context.socket === RECYCLE_SOCKET
    && context.executable.path === "/usr/local/bin/codex"
  )));
  assert.equal(harness.calls.restart, 1);
  assert.equal(harness.calls.stop, 0);
  assert.equal(harness.calls.residue, 1);
  assert.deepEqual(harness.calls.attest, [500, 500, 900]);
  assert.equal(result.verification.after.pid, 900);
  assert.deepEqual(result.verification.after.descriptors, { count: 122, highest: 145 });
  assert.equal(result.verification.after.directChildren, 19);
  assert.equal(result.verification.guiPreserved, true);
  assert.equal(harness.calls.readyContext.mode, "managed");
  assert.equal(harness.calls.readyContext.executable, "/usr/local/bin/codex");
});

test("managed recycle fails closed without a receipt-bound native compare-and-swap", () => {
  const harness = recycleHarness();
  delete harness.deps.restartManagedExact;

  const { result, exitCode } = recycleServer(recycleOptions(), harness.deps);

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.equal(result.verification.mutationAttempted, false);
  assert.ok(result.verification.receipt);
  assert.ok(result.verification.missingEvidence.includes("managed-restart-exact-pid-unsupported"));
  assert.equal(harness.calls.restart, 0);
});

test("missing or conflicting managed evidence never falls through to unmanaged signaling", () => {
  const missing = recycleHarness({
    sampleOverrides: [
      daemonSample(recycleInventoryFixture(), null),
      daemonSample(recycleInventoryFixture(), null),
    ],
  });
  assert.equal(recycleServer(recycleOptions(), missing.deps).exitCode, EXIT_CODES.refused);
  assert.equal(missing.calls.restart, 0);
  assert.equal(missing.calls.stop, 0);

  const conflictingFixture = recycleInventoryFixture();
  const first = daemonSample(conflictingFixture);
  const second = daemonSample(conflictingFixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  const conflicting = recycleHarness({ sampleOverrides: [first, second] });
  assert.equal(recycleServer(recycleOptions(), conflicting.deps).exitCode, EXIT_CODES.refused);
  assert.equal(conflicting.calls.restart, 0);
  assert.equal(conflicting.calls.stop, 0);
});

test("attestor absence and mismatched old-PID attestation refuse before mutation", () => {
  const absent = recycleHarness();
  assert.equal(recycleServer({ ...confirmedRecycleOptions(), attestorPath: null }, absent.deps).exitCode, EXIT_CODES.refused);
  assert.equal(absent.calls.restart, 0);

  const invalid = recycleHarness();
  invalid.deps.attestNofile = (identity) => ({
    schema: "codex-nofile-attestation-v1",
    pid: identity.pid + 1,
    uid: identity.uid,
    processStartTime: identity.startTime,
    softNofile: 8192,
  });
  assert.equal(recycleServer(recycleOptions({ confirmation: "unused" }), invalid.deps).exitCode, EXIT_CODES.refused);
  assert.equal(invalid.calls.restart, 0);
});

test("an old process below the recovery minimum may recycle when replacement attestation meets it", () => {
  const harness = recycleHarness({ oldSoftNofile: 256 });

  const { result, exitCode } = recycleServer(
    confirmedRecycleOptions({}, { oldSoftNofile: 256 }),
    harness.deps,
  );

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(result.verification.before.softNofile, 256);
  assert.equal(result.verification.after.softNofile, 8192);
});

test("explicit unmanaged recycle validates launcher limit and uses only the selected launcher", () => {
  const harness = recycleHarness({ mode: "unmanaged" });
  const options = confirmedRecycleOptions({
    unmanaged: true,
    launcher: LAUNCHER,
  });
  const { result, exitCode } = recycleServer(options, harness.deps);

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(harness.calls.restart, 0);
  assert.equal(harness.calls.stop, 1);
  assert.equal(harness.calls.launch, 1);
  assert.deepEqual(harness.calls.attestLauncher, [LAUNCHER, LAUNCHER]);
  assert.equal(result.verification.mode, "unmanaged");

  const low = recycleHarness({ mode: "unmanaged" });
  low.deps.attestLauncher = (launcher) => ({
    schema: "codex-launcher-nofile-attestation-v1",
    path: launcher.path,
    dev: launcher.dev,
    ino: launcher.ino,
    replacementExecutable: "/usr/local/bin/codex",
    softNofile: 4096,
  });
  assert.equal(recycleServer(options, low.deps).exitCode, EXIT_CODES.refused);
  assert.equal(low.calls.stop, 0);
  assert.equal(low.calls.launch, 0);

  const linkedLauncher = "/usr/local/bin/codex-link";
  const linkedHarness = () => {
    const candidate = recycleHarness({ mode: "unmanaged" });
    const canonicalPath = candidate.deps.canonicalPath;
    candidate.deps.canonicalPath = (value) => value === linkedLauncher
      ? LAUNCHER
      : canonicalPath(value);
    return candidate;
  };
  const probe = linkedHarness();
  const linkedOptions = recycleOptions({
    unmanaged: true,
    launcher: linkedLauncher,
  });
  const probeOutcome = recycleServer(linkedOptions, probe.deps);
  const linked = linkedHarness();
  const linkedOutcome = recycleServer({
    ...linkedOptions,
    confirmation: probeOutcome.result.verification.receipt.confirmationToken,
  }, linked.deps);
  assert.equal(linkedOutcome.exitCode, EXIT_CODES.healthy);
  assert.equal(linkedOutcome.result.verification.receipt.launcher.path, LAUNCHER);
});

test("attempted restart, readiness, socket, and replacement attestation failures preserve exact reasons", () => {
  const cases = [
    {
      expected: "managed-restart-failed",
      configure: (harness) => { harness.deps.restartManagedExact = () => { throw new Error("restart failed"); }; },
    },
    {
      expected: "replacement-readiness-timeout",
      configure: (harness) => { harness.deps.waitForReady = () => null; },
    },
    {
      expected: "replacement-socket-invalid",
      configure: (harness) => {
        harness.deps.waitForReady = () => ({
          identity: harness.replacement,
          socket: { path: RECYCLE_SOCKET, ready: true, owners: [] },
          descriptors: { count: 10, highest: 12 },
          directChildren: 1,
        });
      },
    },
    {
      expected: "pid-nofile-attestation-invalid",
      configure: (harness) => {
        const original = harness.deps.attestNofile;
        harness.deps.attestNofile = (identity) => identity.pid === 900
          ? { schema: "codex-nofile-attestation-v1", pid: 900, uid: 501, processStartTime: identity.startTime, softNofile: 4096 }
          : original(identity);
      },
    },
  ];

  for (const { configure, expected } of cases) {
    const harness = recycleHarness();
    configure(harness);
    const { result, exitCode } = recycleServer(confirmedRecycleOptions(), harness.deps);
    assert.equal(exitCode, EXIT_CODES.failed);
    assert.equal(result.verification.complete, false);
    assert.equal(result.verification.mutationAttempted, true);
    assert.ok(result.verification.missingEvidence.includes(expected));
  }
});

test("post-mutation recovery evidence preserves exact readiness and residue failures", () => {
  const readiness = recycleHarness();
  readiness.deps.waitForReady = () => ({ failureCode: "replacement-socket-ownership-mismatch" });
  const readinessOutcome = recycleServer(confirmedRecycleOptions(), readiness.deps);
  assert.equal(readinessOutcome.exitCode, EXIT_CODES.failed);
  assert.ok(readinessOutcome.result.verification.missingEvidence.includes(
    "replacement-socket-ownership-mismatch",
  ));

  const residue = recycleHarness();
  residue.deps.reapResidue = () => ({
    exitCode: EXIT_CODES.failed,
    result: { verification: { missingEvidence: ["post-kill-survivor"] } },
  });
  const residueOutcome = recycleServer(confirmedRecycleOptions(), residue.deps);
  assert.equal(residueOutcome.exitCode, EXIT_CODES.failed);
  assert.ok(residueOutcome.result.verification.missingEvidence.includes("post-kill-survivor"));
});

test("post-verification requires old tree absence and GUI preservation", () => {
  const residue = recycleHarness();
  residue.deps.reapResidue = () => {
    residue.calls.residue += 1;
    return { exitCode: EXIT_CODES.healthy };
  };
  assert.equal(recycleServer(confirmedRecycleOptions(), residue.deps).exitCode, EXIT_CODES.failed);

  const gui = recycleHarness();
  const originalRestart = gui.deps.restartManagedExact;
  gui.deps.restartManagedExact = () => {
    const response = originalRestart();
    const oldGui = gui.state.get(101).identity;
    gui.state.set(101, { state: "present", identity: { ...oldGui, startTime: "2026-08-02T15:01:00.000Z" } });
    return response;
  };
  assert.equal(recycleServer(confirmedRecycleOptions(), gui.deps).exitCode, EXIT_CODES.failed);
});

test("CLI routes recycle through the guarded dependency surface", () => {
  const harness = recycleHarness();
  const options = confirmedRecycleOptions();
  const output = [];

  const exitCode = runCli([
    "recycle",
    "--pid", String(options.pid),
    "--confirm", options.confirmation,
    "--nofile-attestor", ATTESTOR,
    "--json",
  ], {
    platform: "darwin",
    uid: 501,
    inventory: harness.fixture,
    readIdentity: harness.deps.readIdentity,
    recycleDependencies: harness.deps,
    env: {},
    write: (value) => output.push(value),
  });

  assert.equal(exitCode, EXIT_CODES.healthy);
  assert.equal(JSON.parse(output[0]).action, "recycle");
  assert.equal(harness.calls.restart, 1);
});

test("CLI receipt pass binds the attestor and minimum before confirmation", () => {
  const harness = recycleHarness();
  const output = [];

  const exitCode = runCli([
    "recycle",
    "--pid", "500",
    "--nofile-attestor", ATTESTOR,
    "--json",
  ], {
    platform: "darwin",
    uid: 501,
    inventory: harness.fixture,
    readIdentity: harness.deps.readIdentity,
    recycleDependencies: harness.deps,
    env: {},
    write: (value) => output.push(value),
  });

  const result = JSON.parse(output[0]);
  assert.equal(exitCode, EXIT_CODES.refused);
  assert.deepEqual(result.verification.missingEvidence, ["confirmation-required"]);
  assert.equal(result.verification.receipt.minimumSoftNofile, 8192);
  assert.equal(result.verification.receipt.attestor.path, ATTESTOR);
  assert.equal(result.verification.mutationAttempted, false);
});

test("confirmation token cannot authorize a different minimum", () => {
  const harness = recycleHarness();
  const options = confirmedRecycleOptions();
  const { result, exitCode } = recycleServer({ ...options, minSoftLimit: 16384 }, harness.deps);

  assert.equal(exitCode, EXIT_CODES.refused);
  assert.ok(result.verification.missingEvidence.includes("confirmation-mismatch"));
  assert.equal(harness.calls.restart, 0);
});

test("recycle refuses when any app-server classification is incomplete", () => {
  const ambiguousServer = processRecord({
    pid: 700,
    parentPid: 70,
    processGroupId: 700,
    executable: "/usr/local/bin/codex",
    rawCommand: "/usr/local/bin/codex app-server",
  });
  const initial = recycleHarness();
  initial.fixture.processes.push(
    processRecord({ pid: 70, parentPid: 1, processGroupId: 70, rawCommand: "/bin/zsh" }),
    ambiguousServer,
  );
  initial.fixture.descriptors[700] = { complete: true, count: 8, highest: 9 };

  const initialOutcome = recycleServer(recycleOptions(), initial.deps);
  assert.equal(initialOutcome.exitCode, EXIT_CODES.refused);
  assert.deepEqual(initialOutcome.result.verification.missingEvidence, ["inventory-incomplete"]);
  assert.equal(initial.calls.samples, 0);

  const locked = recycleHarness();
  const lockedInventory = structuredClone(locked.fixture);
  lockedInventory.processes.push(
    processRecord({ pid: 70, parentPid: 1, processGroupId: 70, rawCommand: "/bin/zsh" }),
    ambiguousServer,
  );
  lockedInventory.descriptors[700] = { complete: true, count: 8, highest: 9 };
  locked.deps.collectInventory = () => lockedInventory;

  const lockedOutcome = recycleServer(confirmedRecycleOptions(), locked.deps);
  assert.equal(lockedOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(lockedOutcome.result.verification.missingEvidence.includes("inventory-recheck-incomplete"));
  assert.equal(locked.calls.restart, 0);

  const reclassified = recycleHarness();
  const reclassifiedInventory = structuredClone(reclassified.fixture);
  reclassifiedInventory.processes.find((item) => item.pid === 500).parentPid = 10;
  reclassified.deps.collectInventory = () => reclassifiedInventory;

  const reclassifiedOutcome = recycleServer(confirmedRecycleOptions(), reclassified.deps);
  assert.equal(reclassifiedOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(reclassifiedOutcome.result.verification.missingEvidence.includes(
    "selected-server-recheck-incomplete",
  ));
  assert.equal(reclassified.calls.restart, 0);
});

test("late proxy and GUI drift refuse under the mutation lock", () => {
  const proxy = recycleHarness();
  const lateInventory = structuredClone(proxy.fixture);
  lateInventory.processes.push(processRecord({
    pid: 602,
    parentPid: 60,
    processGroupId: 602,
    executable: "/usr/local/bin/codex",
    rawCommand: "/usr/local/bin/codex app-server proxy",
  }));
  lateInventory.proxySockets[602] = {
    complete: true,
    paths: [RECYCLE_SOCKET],
    connections: [{ endpoint: "0x602", peerEndpoint: "0x500" }],
  };
  proxy.deps.collectInventory = () => lateInventory;
  const proxyOutcome = recycleServer(confirmedRecycleOptions(), proxy.deps);
  assert.equal(proxyOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(proxyOutcome.result.verification.missingEvidence.includes("proxy-set-changed"));
  assert.equal(proxy.calls.restart, 0);

  const gui = recycleHarness();
  gui.deps.lock.acquire = () => {
    const baseline = gui.state.get(101).identity;
    gui.state.set(101, {
      state: "present",
      identity: { ...baseline, startTime: "2026-08-02T15:01:00.000Z" },
    });
    return () => {};
  };
  const guiOutcome = recycleServer(confirmedRecycleOptions(), gui.deps);
  assert.equal(guiOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(guiOutcome.result.verification.missingEvidence.includes("gui-preservation-failed"));
  assert.equal(gui.calls.restart, 0);
});

test("a descendant that joins after confirmation refuses under the mutation lock", () => {
  const harness = recycleHarness();
  const lateInventory = structuredClone(harness.fixture);
  lateInventory.processes.push(processRecord({
    pid: 502,
    parentPid: 500,
    processGroupId: 500,
    executable: "/usr/bin/true",
    rawCommand: "/usr/bin/true",
  }));
  harness.deps.collectInventory = () => lateInventory;

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("exact-tree-changed"));
  assert.equal(harness.calls.restart, 0);
});

test("a descendant that joins during locked attestation refuses before mutation", () => {
  const harness = recycleHarness();
  const lateInventory = structuredClone(harness.fixture);
  lateInventory.processes.push(processRecord({
    pid: 502,
    parentPid: 500,
    processGroupId: 500,
    executable: "/usr/bin/true",
    rawCommand: "/usr/bin/true",
  }));
  const attestNofile = harness.deps.attestNofile;
  let attestations = 0;
  harness.deps.attestNofile = (...args) => {
    const attestation = attestNofile(...args);
    attestations += 1;
    if (attestations === 2) harness.deps.collectInventory = () => lateInventory;
    return attestation;
  };

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("exact-tree-changed"));
  assert.equal(harness.calls.restart, 0);
});

test("locked daemon drift and executable replacement refuse before mutation", () => {
  const daemon = recycleHarness();
  const base = daemonSample(daemon.fixture);
  const drift = daemonSample(daemon.fixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  let sample = 0;
  daemon.deps.sampleDaemonEvidence = () => structuredClone([base, base, drift][Math.min(sample++, 2)]);
  const daemonOutcome = recycleServer(confirmedRecycleOptions(), daemon.deps);
  assert.equal(daemonOutcome.exitCode, EXIT_CODES.refused);
  assert.equal(daemon.calls.restart, 0);

  const executable = recycleHarness();
  const originalFileIdentity = executable.deps.fileIdentity;
  let changed = false;
  executable.deps.fileIdentity = (value) => {
    const evidence = originalFileIdentity(value);
    return changed && value === ATTESTOR ? { ...evidence, digest: "d".repeat(64) } : evidence;
  };
  executable.deps.lock.acquire = () => {
    changed = true;
    return () => {};
  };
  const executableOutcome = recycleServer(confirmedRecycleOptions(), executable.deps);
  assert.equal(executableOutcome.exitCode, EXIT_CODES.refused);
  assert.ok(executableOutcome.result.verification.missingEvidence.includes("nofile-attestor-changed"));
  assert.equal(executable.calls.restart, 0);
});

test("daemon drift in the immediate pre-mutation sample refuses", () => {
  const fixture = recycleInventoryFixture();
  const base = daemonSample(fixture);
  const drift = daemonSample(fixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  const harness = recycleHarness({ sampleOverrides: [base, base, base, drift] });

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("daemon-socket-ownership-conflict"));
  assert.equal(harness.calls.samples, 4);
  assert.equal(harness.calls.restart, 0);
});

test("daemon drift during locked inventory refuses before mutation", () => {
  const harness = recycleHarness();
  const base = daemonSample(harness.fixture);
  const drift = daemonSample(harness.fixture, "pid", {
    socketOwners: [{ pid: 999, uid: 501 }],
  });
  let inventoryCollected = false;
  harness.deps.sampleDaemonEvidence = () => structuredClone(inventoryCollected ? drift : base);
  harness.deps.collectInventory = () => {
    inventoryCollected = true;
    return harness.fixture;
  };

  const outcome = recycleServer(confirmedRecycleOptions(), harness.deps);

  assert.equal(outcome.exitCode, EXIT_CODES.refused);
  assert.ok(outcome.result.verification.missingEvidence.includes("daemon-socket-ownership-conflict"));
  assert.equal(harness.calls.restart, 0);
});

test("default daemon adapter reads the native PID record and ignores an exact proxy client", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-daemon-"));
  try {
    const uid = process.getuid();
    const codexHome = path.join(directory, "codex-home");
    const daemonDirectory = path.join(codexHome, "app-server-daemon");
    const executable = path.join(directory, "codex");
    const socket = path.join(directory, "app-server-control.sock");
    fs.mkdirSync(daemonDirectory, { recursive: true });
    fs.writeFileSync(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    fs.writeFileSync(socket, "fixture", { mode: 0o600 });
    const pidRecord = path.join(daemonDirectory, "app-server.pid");
    fs.writeFileSync(pidRecord, JSON.stringify({
      pid: 500,
      processStartTime: "2026-08-02T16:00:00.000Z",
    }), { mode: 0o600 });
    const canonicalExecutable = fs.realpathSync(executable);
    const canonicalSocket = fs.realpathSync(socket);
    const owner = exactIdentity({
      pid: 500,
      parentPid: 1,
      processGroupId: 500,
      uid,
      startTime: "2026-08-02T16:00:00.000Z",
      executable: canonicalExecutable,
    });
    let omitBackend = false;
    let runFailure = null;
    const runner = (file, args) => {
      if (file === canonicalExecutable) {
        assert.deepEqual(args, ["app-server", "daemon", "version"]);
        return {
          status: 0,
          stdout: JSON.stringify({
            status: "running",
            ...(!omitBackend ? { backend: "pid" } : {}),
            managedCodexPath: canonicalExecutable,
            socketPath: canonicalSocket,
          }),
          stderr: "",
          ...runFailure,
        };
      }
      if (file === "/usr/sbin/lsof") {
        assert.deepEqual(args, ["-nP", "-U", "-Fpcfn"]);
        return {
          status: 0,
          stdout: `p500\nccodex\nf10\nn${canonicalSocket}\np600\nccodex\nf11\nn${canonicalSocket}\n`,
          stderr: "",
        };
      }
      if (file === "/bin/ps") {
        assert.deepEqual(args, ["-p", "600", "-o", "command="]);
        return { status: 0, stdout: `${canonicalExecutable} app-server proxy\n`, stderr: "" };
      }
      throw new Error(`unexpected command: ${file}`);
    };
    const dependencies = createDefaultRecycleDependencies({
      inventory: inventory(),
      runner,
      env: { CODEX_HOME: codexHome },
      uid,
      readIdentity: (pid) => pid === owner.pid
        ? { state: "present", identity: owner }
        : { state: "unknown" },
    });

    const evidence = dependencies.sampleDaemonEvidence({
      socket: canonicalSocket,
      executable: { path: canonicalExecutable },
      ownerPid: owner.pid,
    });

    assert.deepEqual(evidence.socketOwners, [{ pid: owner.pid, uid }]);
    assert.deepEqual(evidence.pidRecord, {
      state: "valid",
      uid,
      regular: true,
      symlink: false,
      pid: owner.pid,
      processStartTime: owner.startTime,
    });
    assert.equal(evidence.managedExecutable.path, canonicalExecutable);

    omitBackend = true;
    assert.throws(
      () => dependencies.sampleDaemonEvidence({
        socket: canonicalSocket,
        executable: { path: canonicalExecutable },
        ownerPid: owner.pid,
      }),
      (error) => error.code === "daemon-version-invalid",
    );
    omitBackend = false;

    for (const failure of [
      { error: Object.assign(new Error("timed out"), { code: "ETIMEDOUT" }) },
      { signal: "SIGKILL" },
    ]) {
      runFailure = failure;
      assert.throws(
        () => dependencies.sampleDaemonEvidence({
          socket: canonicalSocket,
          executable: { path: canonicalExecutable },
          ownerPid: owner.pid,
        }),
        (error) => error.code === "daemon-version-unavailable",
      );
    }
    runFailure = null;

    fs.chmodSync(pidRecord, 0o666);
    assert.deepEqual(dependencies.sampleDaemonEvidence({
      socket: canonicalSocket,
      executable: { path: canonicalExecutable },
      ownerPid: owner.pid,
    }).pidRecord, { state: "invalid" });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("file identity hashes the opened inode instead of a later pathname lookup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-file-identity-"));
  try {
    const executable = path.join(directory, "codex");
    const contents = Buffer.from("#!/bin/sh\nexit 0\n");
    fs.writeFileSync(executable, contents, { mode: 0o755 });
    let pathRead = false;
    const fsApi = {
      ...fs,
      readFileSync(target, ...args) {
        if (typeof target !== "number") {
          pathRead = true;
          return Buffer.from("replacement pathname contents");
        }
        return fs.readFileSync(target, ...args);
      },
    };
    const dependencies = createDefaultRecycleDependencies({
      inventory: inventory(),
      fsApi,
    });

    const identity = dependencies.fileIdentity(executable);

    assert.equal(pathRead, false);
    assert.equal(identity.size, contents.length);
    assert.equal(identity.digest, createHash("sha256").update(contents).digest("hex"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unsafe attestor files and pre-signal unmanaged drift remain exit 2", () => {
  const unsafe = recycleHarness();
  const originalFileIdentity = unsafe.deps.fileIdentity;
  unsafe.deps.fileIdentity = (value) => value === ATTESTOR
    ? { ...originalFileIdentity(value), mode: 0o100777 }
    : originalFileIdentity(value);
  const unsafeOutcome = recycleServer(recycleOptions(), unsafe.deps);
  assert.equal(unsafeOutcome.exitCode, EXIT_CODES.refused);
  assert.equal(unsafeOutcome.result.verification.mutationAttempted, false);

  const stopped = recycleHarness({ mode: "unmanaged" });
  stopped.deps.stopUnmanaged = () => ({
    exitCode: EXIT_CODES.refused,
    mutationAttempted: false,
    failureCode: "unmanaged-identity-changed",
  });
  const stoppedOutcome = recycleServer(confirmedRecycleOptions({
    unmanaged: true,
    launcher: LAUNCHER,
  }), stopped.deps);
  assert.equal(stoppedOutcome.exitCode, EXIT_CODES.refused);
  assert.equal(stoppedOutcome.result.verification.mutationAttempted, false);
  assert.ok(stoppedOutcome.result.verification.missingEvidence.includes("unmanaged-identity-changed"));
  assert.equal(stopped.calls.launch, 0);
});

test("default readiness reports the last exact recovery failure", () => {
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    uid: process.getuid(),
    readIdentity: () => ({ state: "absent" }),
    readyTimeoutMs: 0,
  });

  assert.deepEqual(dependencies.waitForReady({
    pid: 900,
    socketPath: RECYCLE_SOCKET,
    mode: "managed",
    executable: "/usr/local/bin/codex",
  }), { failureCode: "replacement-identity-not-ready" });
});

test("default unmanaged launcher absorbs asynchronous spawn errors", () => {
  const child = new EventEmitter();
  child.pid = undefined;
  child.unref = () => {};
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    spawnProcess: () => child,
  });

  assert.deepEqual(dependencies.launchUnmanaged({
    launcher: "/tmp/codex-wrapper",
    socketPath: RECYCLE_SOCKET,
  }), { pid: null });
  assert.equal(child.listenerCount("error"), 1);
  assert.doesNotThrow(() => child.emit("error", Object.assign(new Error("spawn failed"), { code: "ENOENT" })));
});

test("readiness bounds every default process probe to the remaining deadline", () => {
  let clock = 0;
  const calls = [];
  const runner = (file, args, { timeout } = {}) => {
    calls.push({ file, args, timeout });
    clock += timeout;
    return { status: null, stdout: "", stderr: "", error: true };
  };
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    runner,
    readyTimeoutMs: 50,
    readyPollMs: 10,
    monotonicNow: () => clock,
    sleep: () => assert.fail("exhausted deadline must not sleep"),
  });

  assert.deepEqual(dependencies.waitForReady({
    pid: 900,
    socketPath: RECYCLE_SOCKET,
    mode: "managed",
    executable: "/usr/local/bin/codex",
  }), { failureCode: "replacement-identity-not-ready" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].timeout, 50);
});

test("readiness bounds the socket owner identity recheck", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-ready-"));
  try {
    const socket = path.join(directory, "app-server-control.sock");
    fs.writeFileSync(socket, "fixture", { mode: 0o600 });
    const canonicalSocket = fs.realpathSync(socket);
    const executable = "/usr/local/bin/codex";
    const uid = process.getuid();
    const identity = exactIdentity({
      pid: 900,
      parentPid: 1,
      processGroupId: 900,
      uid,
      executable,
    });
    let clock = 0;
    const identityRunners = [];
    const runner = (file, args, { timeout } = {}) => {
      assert.ok(timeout > 0 && timeout <= 50);
      if (file === executable) {
        return {
          status: 0,
          stdout: JSON.stringify({
            status: "running",
            backend: "pid",
            managedCodexPath: executable,
            socketPath: canonicalSocket,
          }),
          stderr: "",
        };
      }
      if (file === "/usr/sbin/lsof" && args.includes("-U")) {
        return { status: 0, stdout: `p900\nccodex\nf10\nn${canonicalSocket}\n`, stderr: "" };
      }
      if (file === "/usr/sbin/lsof" && args.includes("-a")) {
        clock += timeout;
        return { status: null, stdout: "", stderr: "", error: true };
      }
      throw new Error(`unexpected command: ${file} ${args.join(" ")}`);
    };
    const dependencies = createDefaultRecycleDependencies({
      inventory: inventory(),
      runner,
      uid,
      readyTimeoutMs: 50,
      readyPollMs: 10,
      monotonicNow: () => clock,
      sleep: (milliseconds) => { clock += milliseconds; },
      readIdentity(pid, { runner: identityRunner } = {}) {
        assert.equal(pid, identity.pid);
        identityRunners.push(identityRunner);
        return { state: "present", identity };
      },
    });

    assert.deepEqual(dependencies.waitForReady({
      pid: identity.pid,
      socketPath: canonicalSocket,
      mode: "managed",
      executable,
    }), { failureCode: "replacement-descriptors-unavailable" });
    assert.equal(identityRunners.length, 2);
    assert.ok(identityRunners.every((identityRunner) => typeof identityRunner === "function"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("unmanaged stop kills a TERM-resistant child after natural reparenting", () => {
  const snapshot = snapshotFixture();
  const states = new Map([
    [snapshot.owner.pid, snapshot.owner],
    [snapshot.targets[0].pid, snapshot.targets[0]],
  ]);
  const signals = [];
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    readIdentity(pid) {
      const identity = states.get(pid);
      return identity ? { state: "present", identity } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      if (pid === snapshot.owner.pid && signal === "SIGTERM") {
        states.delete(pid);
        states.set(snapshot.targets[0].pid, { ...snapshot.targets[0], parentPid: 1 });
      }
      if (pid === snapshot.targets[0].pid && signal === "SIGKILL") states.delete(pid);
    },
    sleep: () => {},
  });

  assert.deepEqual(dependencies.stopUnmanaged(snapshot), {
    exitCode: EXIT_CODES.healthy,
    mutationAttempted: true,
    failureCode: null,
  });
  assert.deepEqual(signals, [
    [snapshot.targets[0].pid, "SIGTERM"],
    [snapshot.owner.pid, "SIGTERM"],
    [snapshot.targets[0].pid, "SIGKILL"],
  ]);
  assert.equal(states.size, 0);
});

test("unmanaged stop refuses same-start UID drift after TERM", () => {
  const snapshot = snapshotFixture();
  const states = new Map([
    [snapshot.owner.pid, snapshot.owner],
    [snapshot.targets[0].pid, snapshot.targets[0]],
  ]);
  const signals = [];
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    readIdentity(pid) {
      const identity = states.get(pid);
      return identity ? { state: "present", identity } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      if (pid === snapshot.targets[0].pid && signal === "SIGTERM") {
        states.set(pid, { ...snapshot.targets[0], uid: snapshot.targets[0].uid + 1 });
      }
      if (pid === snapshot.owner.pid && signal === "SIGTERM") states.delete(pid);
    },
    sleep: () => {},
  });

  assert.deepEqual(dependencies.stopUnmanaged(snapshot), {
    exitCode: EXIT_CODES.failed,
    mutationAttempted: true,
    failureCode: "unmanaged-post-term-identity-unverified",
  });
  assert.deepEqual(signals, [
    [snapshot.targets[0].pid, "SIGTERM"],
    [snapshot.owner.pid, "SIGTERM"],
  ]);
  assert.equal(states.has(snapshot.targets[0].pid), true);
});

const HOOK_THREAD = "11111111-1111-4111-8111-111111111111";
const OTHER_THREAD = "22222222-2222-4222-8222-222222222222";

function hookCleanupFixture(processes) {
  const uid = process.getuid();
  const started = "Sun Aug 2 12:00:00 2026";
  const startedAt = new Date(started).toISOString();
  const records = new Map(processes.map((record) => [record.pid, {
    uid, startTime: startedAt, executable: "/bin/sh", ...record,
  }]));
  const signals = [];
  const row = (record, command) => (
    `${record.pid} ${record.parentPid} ${record.processGroupId} ${record.uid} ${started} ${command}\n`
  );
  const server = { pid: 500, parentPid: 1, processGroupId: 500, uid, startTime: startedAt };
  const hook = { pid: 700, parentPid: 500, processGroupId: 500, uid, startTime: startedAt };
  return {
    uid,
    startedAt,
    signals,
    remove(pid) { records.delete(pid); },
    add(record) {
      records.set(record.pid, { uid, startTime: startedAt, executable: "/bin/sh", ...record });
    },
    runner(file, args) {
      if (file !== "/bin/ps" && file !== "/usr/sbin/lsof") return { status: 1, stdout: "", stderr: "" };
      if (file === "/usr/sbin/lsof") {
        if (args.includes("-d") && args.includes("txt")) {
          const pids = String(args[args.indexOf("-p") + 1]).split(",").map(Number);
          return {
            status: 0,
            stdout: pids.flatMap((pid) => records.has(pid)
              ? [`p${pid}`, "ftxt", "tREG", `n${records.get(pid).executable}`]
              : []).join("\n"),
            stderr: "",
          };
        }
        return { status: 0, stdout: "ftxt\nn/usr/local/bin/codex\nf10\nn/tmp/app-server-control.sock\n", stderr: "" };
      }
      if (args[0] === "ww" || args[0] === "eww") {
        const env = args[0] === "eww";
        const all = [server, hook, ...records.values()];
        return { status: 0, stdout: all.map((record) => {
          const command = record.pid === 500 ? "/usr/local/bin/codex app-server"
            : record.pid === 700 ? "/bin/sh hook"
              : record.command ?? "/bin/sh worker";
          return row(record, env && record.threadId
            ? `${command} CODEX_THREAD_ID=${record.threadId} SECRET_VALUE=never-write-this`
            : command);
        }).join(""), stderr: "" };
      }
      const pid = Number(args[1]);
      const record = pid === 500 ? server : pid === 700 ? hook : records.get(pid);
      if (!record) return { status: 1, stdout: "", stderr: "" };
      const command = args.at(-1).endsWith("command=")
        ? (pid === 500 ? "/usr/local/bin/codex app-server" : "/bin/sh hook")
        : "/usr/local/bin/codex";
      return { status: 0, stdout: row(record, command), stderr: "" };
    },
    readIdentity(pid) {
      const record = records.get(pid);
      return record ? { state: "present", identity: {
        pid: record.pid,
        parentPid: record.parentPid,
        processGroupId: record.processGroupId,
        uid: record.uid,
        startTime: record.startTime,
        executable: record.executable,
      } } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      signals.push([pid, signal]);
      if (signal === "SIGKILL") records.delete(pid);
    },
  };
}

function runHookFixture(fixture, directory) {
  return inspectHook({
    platform: "darwin",
    runner: fixture.runner,
    env: { XDG_STATE_HOME: directory, HOME: directory },
    uid: fixture.uid,
    now: Date.parse(fixture.startedAt) + 1_000,
    parentPid: 700,
    sessionId: HOOK_THREAD,
    readIdentity: fixture.readIdentity,
    signalProcess: fixture.signalProcess,
    sleep: () => {},
    lock: { acquire: () => () => {} },
  });
}

test("SessionEnd hook TERM then KILLs exact matching PIDs and writes no environment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 801, parentPid: 1, processGroupId: 800, threadId: HOOK_THREAD },
      { pid: 802, parentPid: 801, processGroupId: 800, threadId: HOOK_THREAD },
      { pid: 803, parentPid: 1, processGroupId: 803, threadId: OTHER_THREAD },
    ]);
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.deepEqual(fixture.signals, [
      [802, "SIGTERM"], [801, "SIGTERM"], [802, "SIGKILL"], [801, "SIGKILL"],
    ]);
    assert.deepEqual(outcome.receipt.cleanup.selectedPids.sort(), [801, 802]);
    const receipt = fs.readFileSync(outcome.receiptPath, "utf8");
    assert.doesNotMatch(receipt, /CODEX_THREAD_ID|SECRET_VALUE|never-write-this|\/bin\/sh worker/);
    assert.equal(fs.statSync(outcome.receiptPath).mode & 0o777, 0o600);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook refuses mixed-thread and hook/app-server groups", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-refuse-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 810, parentPid: 1, processGroupId: 810, threadId: HOOK_THREAD },
      { pid: 811, parentPid: 1, processGroupId: 810, threadId: OTHER_THREAD },
      { pid: 812, parentPid: 700, processGroupId: 500, threadId: HOOK_THREAD },
    ]);
    const outcome = runHookFixture(fixture, directory);
    assert.deepEqual(fixture.signals, []);
    assert.deepEqual(outcome.receipt.cleanup.selectedPids, []);
    assert.ok(outcome.receipt.cleanup.skippedGroups.some((group) => group.reasons.includes("mixed-thread-group")));
    assert.ok(outcome.receipt.cleanup.skippedGroups.some((group) => group.reasons.includes("hook-or-app-server-group")));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook accepts native disappearance and never KILLs a TERM-responsive target", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-natural-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 820, parentPid: 1, processGroupId: 820, threadId: HOOK_THREAD },
      { pid: 821, parentPid: 1, processGroupId: 821, threadId: HOOK_THREAD },
    ]);
    const baseRunner = fixture.runner;
    let scans = 0;
    fixture.runner = (file, args, options) => {
      if (file === "/bin/ps" && args[0] === "ww" && ++scans === 2) fixture.remove(820);
      return baseRunner(file, args, options);
    };
    fixture.signalProcess = (pid, signal) => {
      fixture.signals.push([pid, signal]);
      if (signal === "SIGTERM") fixture.remove(pid);
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.deepEqual(fixture.signals, [[821, "SIGTERM"]]);
    assert.deepEqual(outcome.receipt.cleanup.verifiedPids.sort(), [820, 821]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook treats SIGKILL ESRCH as already gone", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-esrch-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 830, parentPid: 1, processGroupId: 830, threadId: HOOK_THREAD },
    ]);
    fixture.signalProcess = (pid, signal) => {
      fixture.signals.push([pid, signal]);
      if (signal === "SIGKILL") {
        fixture.remove(pid);
        const error = new Error("gone");
        error.code = "ESRCH";
        throw error;
      }
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.deepEqual(fixture.signals, [[830, "SIGTERM"], [830, "SIGKILL"]]);
    assert.deepEqual(outcome.receipt.cleanup.verifiedPids, [830]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook fails closed when post-TERM identity is unknown", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-unknown-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 840, parentPid: 1, processGroupId: 840, threadId: HOOK_THREAD },
    ]);
    const originalReadIdentity = fixture.readIdentity;
    let reads = 0;
    fixture.readIdentity = (pid) => {
      reads += 1;
      return pid === 840 && reads >= 1 ? { state: "unknown" } : originalReadIdentity(pid);
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "failed");
    assert.deepEqual(fixture.signals, [[840, "SIGTERM"]]);
    assert.ok(outcome.receipt.missingEvidence.includes("hook-post-term-identity-unavailable"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook KILLs an exact process created during TERM grace", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-late-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 850, parentPid: 1, processGroupId: 850, threadId: HOOK_THREAD },
    ]);
    const originalSignal = fixture.signalProcess;
    fixture.signalProcess = (pid, signal) => {
      originalSignal(pid, signal);
      if (pid === 850 && signal === "SIGTERM") {
        fixture.add({ pid: 851, parentPid: 850, processGroupId: 850, threadId: HOOK_THREAD });
      }
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "healthy");
    assert.ok(fixture.signals.some(([pid, signal]) => pid === 851 && signal === "SIGKILL"));
    assert.ok(outcome.receipt.cleanup.verifiedPids.includes(851));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionEnd hook fails if a target appears during the late KILL pass", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cleanup-codex-hook-final-"));
  try {
    const fixture = hookCleanupFixture([
      { pid: 860, parentPid: 1, processGroupId: 860, threadId: HOOK_THREAD },
    ]);
    const originalSignal = fixture.signalProcess;
    fixture.signalProcess = (pid, signal) => {
      originalSignal(pid, signal);
      if (pid === 860 && signal === "SIGTERM") {
        fixture.add({ pid: 861, parentPid: 860, processGroupId: 860, threadId: HOOK_THREAD });
      } else if (pid === 861 && signal === "SIGKILL") {
        fixture.add({ pid: 862, parentPid: 1, processGroupId: 862, threadId: HOOK_THREAD });
      }
    };
    const outcome = runHookFixture(fixture, directory);
    assert.equal(outcome.status, "failed");
    assert.ok(outcome.receipt.missingEvidence.includes("hook-final-target-survivor"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid SessionEnd stdin fails closed without scanning or mutation", () => {
  const calls = [];
  const signals = [];
  for (const hookInput of ["", "{}", '{"hook_event_name":"Stop","session_id":"11111111-1111-4111-8111-111111111111"}']) {
    assert.equal(runCli(["cleanup", "--hook"], {
      platform: "darwin",
      hookInput,
      runner: (...args) => { calls.push(args); throw new Error("must not scan"); },
      signalProcess: (...args) => signals.push(args),
    }), EXIT_CODES.refused);
  }
  assert.deepEqual(calls, []);
  assert.deepEqual(signals, []);
});

test("non-macOS SessionEnd hook no-ops with exit 0 before reading stdin", () => {
  for (const platform of ["win32", "linux"]) {
    assert.equal(runCli(["cleanup", "--hook"], {
      platform,
      env: {},
      hookInput: "",
      runner: () => { throw new Error("must not scan"); },
      signalProcess: () => { throw new Error("must not signal"); },
      write: () => {},
    }), EXIT_CODES.healthy);
  }
});

test("plugin packaging exposes actual root SessionEnd cleanup and no Claude hook", () => {
  const codexManifest = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, ".codex-plugin", "plugin.json"),
    "utf8",
  ));
  const claudeManifest = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, ".claude-plugin", "plugin.json"),
    "utf8",
  ));
  const hooks = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, "codex", "hooks.json"),
    "utf8",
  ));

  assert.match(codexManifest.version, /^\d+\.\d+\.\d+$/);
  assert.equal(codexManifest.hooks, "./codex/hooks.json");
  assert.ok(codexManifest.interface.defaultPrompt.length <= 3);
  assert.equal(claudeManifest.version, codexManifest.version);
  assert.ok(claudeManifest.skills.includes("./skills/cleanup-codex"));
  // Claude loads only the routing nudges; the SessionEnd cleanup hook stays
  // Codex-only. The Claude hooks file must never register SessionEnd.
  assert.equal(claudeManifest.hooks, "./hooks/claude-hooks.json");
  const claudeHooks = JSON.parse(fs.readFileSync(
    path.join(PLUGIN_DIRECTORY, "hooks", "claude-hooks.json"),
    "utf8",
  ));
  assert.deepEqual(
    Object.keys(claudeHooks.hooks).sort(),
    ["PreToolUse", "SessionStart", "UserPromptSubmit"],
  );
  for (const event of Object.values(claudeHooks.hooks)) {
    for (const entry of event) {
      for (const hook of entry.hooks) {
        assert.doesNotMatch(hook.command, /cleanup-codex/);
      }
    }
  }
  assert.deepEqual(
    Object.keys(hooks.hooks).sort(),
    ["PreToolUse", "SessionEnd", "SessionStart", "UserPromptSubmit"],
  );
  const commandHook = hooks.hooks.SessionEnd[0].hooks[0];
  assert.equal(commandHook.type, "command");
  // Codex clamps SessionEnd timeouts to 3s and warns on anything higher;
  // the script's internal 2.2s budget leaves cold-start headroom under it.
  assert.equal(commandHook.timeout, 3);
  assert.match(commandHook.command, /cleanup-codex\.mjs\" cleanup --hook$/);
  assert.doesNotMatch(commandHook.command, /\breap\b|\brecycle\b|\bStop\b|\bSubagentStop\b/);
});

test("Claude loader excludes the Codex-only SessionEnd hook", (context) => {
  const loaded = spawnChildSync(
    "claude",
    ["--plugin-dir", PLUGIN_DIRECTORY, "plugin", "details", "railyard"],
    { encoding: "utf8", timeout: 10_000 },
  );
  if (loaded.error?.code === "ENOENT") {
    context.skip("Claude loader is unavailable");
    return;
  }
  assert.equal(loaded.status, 0, loaded.stderr);
  // Claude loads exactly the two routing hooks; the Codex-only SessionEnd
  // cleanup hook must not appear.
  assert.match(loaded.stdout, /Hooks \(3\)/);
  assert.match(loaded.stdout, /SessionStart/);
  assert.match(loaded.stdout, /UserPromptSubmit/);
  assert.doesNotMatch(loaded.stdout, /SessionEnd/);
});

test("applicable parent identity must be gone after recycle", () => {
  const gone = recycleHarness();
  const parent = addApplicableParent(gone);
  const originalRestart = gone.deps.restartManagedExact;
  gone.deps.restartManagedExact = (...args) => {
    const result = originalRestart(...args);
    gone.state.set(parent.pid, { state: "absent" });
    return result;
  };
  const success = recycleServer(parentBoundOptions(), gone.deps);
  assert.equal(success.exitCode, EXIT_CODES.healthy);
  assert.deepEqual(success.result.verification.after.oldParent, { pid: parent.pid, gone: true });

  const survivor = recycleHarness();
  addApplicableParent(survivor);
  const failed = recycleServer(parentBoundOptions(), survivor.deps);
  assert.equal(failed.exitCode, EXIT_CODES.failed);
  assert.ok(failed.result.verification.missingEvidence.includes("old-parent-survivor"));
});

test("isolated managed recycle canary replaces a real Unix-socket fixture", {
  skip: process.platform !== "darwin" || !fs.existsSync("/usr/bin/nc"),
  timeout: 10_000,
}, () => {
  const directory = fs.realpathSync(fs.mkdtempSync("/tmp/cleanup-codex-canary."));
  const codex = "/usr/bin/nc";
  const socket = path.join(directory, "app-server-control.sock");
  const codexHome = path.join(directory, "codex-home");
  const daemonDirectory = path.join(codexHome, "app-server-daemon");
  const pidRecord = path.join(daemonDirectory, "app-server.pid");
  const attestor = path.join(directory, "nofile-attestor.cjs");
  const attestationState = path.join(directory, "attestations.json");
  const launcher = path.join(directory, "launch-fixture.mjs");
  const tracked = [];
  const signalCalls = [];
  let activeIdentity = null;
  let restartCalls = 0;
  let nativeSocketUnlinks = 0;

  const sleep = (milliseconds) => {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
  };
  const waitFor = (probe, label, timeout = 3_000) => {
    const deadline = Date.now() + timeout;
    do {
      const value = probe();
      if (value) return value;
      sleep(20);
    } while (Date.now() < deadline);
    throw new Error(`timed out waiting for ${label}`);
  };
  const runActual = (file, args, options = {}) => {
    const run = spawnChildSync(file, args, {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
      timeout: options.timeout ?? 5_000,
    });
    return {
      status: run.status,
      stdout: run.stdout ?? "",
      stderr: run.stderr ?? "",
      error: run.error ?? null,
    };
  };
  const exactLiveIdentity = (pid) => {
    const observation = collectExactProcessIdentity(pid, { runner: runActual });
    return observation?.state === "present" ? observation.identity : null;
  };
  const writeState = (identity) => {
    let state = {};
    try { state = JSON.parse(fs.readFileSync(attestationState, "utf8")); } catch {}
    state[identity.pid] = {
      pid: identity.pid,
      uid: identity.uid,
      processStartTime: identity.startTime,
      softNofile: 8192,
    };
    fs.writeFileSync(attestationState, JSON.stringify(state), { mode: 0o600 });
    fs.chmodSync(attestationState, 0o600);
  };
  const launchServer = () => {
    const launched = runActual(process.execPath, [launcher, codex, socket]);
    assert.equal(launched.status, 0, launched.stderr);
    const pid = Number(launched.stdout.trim());
    assert.ok(Number.isInteger(pid) && pid > 0);
    let observedIdentity = null;
    let identity;
    try {
      identity = waitFor(() => {
        observedIdentity = exactLiveIdentity(pid);
        return observedIdentity?.parentPid === 1 && fs.existsSync(socket) ? observedIdentity : null;
      }, "orphaned Unix-socket fixture");
    } catch (error) {
      throw new Error(
        `${error.message}; pid=${pid} socket=${fs.existsSync(socket)} identity=${JSON.stringify(observedIdentity)}`,
      );
    }
    tracked.push(identity);
    writeState(identity);
    fs.writeFileSync(pidRecord, JSON.stringify({
      pid: identity.pid,
      processStartTime: identity.startTime,
    }), { mode: 0o600 });
    fs.chmodSync(pidRecord, 0o600);
    return identity;
  };
  const stopNativeFixture = (identity) => {
    const current = exactLiveIdentity(identity.pid);
    assert.ok(sameExactIdentity(identity, current));
    process.kill(identity.pid, "SIGTERM");
    waitFor(() => exactLiveIdentity(identity.pid) === null, "old fixture exit");
  };

  try {
    fs.mkdirSync(daemonDirectory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(launcher, [
      "import { spawn } from 'node:child_process';",
      "const child = spawn(process.argv[2], ['-d', '-lU', process.argv[3]], {detached:true,stdio:'ignore'});",
      "child.unref();",
      "console.log(child.pid);",
    ].join("\n"), { mode: 0o600 });
    fs.writeFileSync(attestor, [
      "#!/usr/bin/env node",
      "const fs = require('node:fs');",
      `const state = JSON.parse(fs.readFileSync(${JSON.stringify(attestationState)}, 'utf8'));`,
      "const index = process.argv.indexOf('--pid');",
      "const record = state[process.argv[index + 1]];",
      "if (index < 0 || !record || process.argv[index + 2] !== '--json') process.exit(2);",
      "process.stdout.write(JSON.stringify({schema:'codex-nofile-attestation-v1',...record}));",
    ].join("\n"), { mode: 0o755 });
    activeIdentity = launchServer();

    const originalIdentity = activeIdentity;
    const fixtureInventory = inventory({
      processes: [processRecord({
        pid: originalIdentity.pid,
        parentPid: originalIdentity.parentPid,
        processGroupId: originalIdentity.processGroupId,
        uid: originalIdentity.uid,
        startTime: originalIdentity.startTime,
        executable: originalIdentity.executable,
        rawCommand: `/usr/local/bin/codex app-server --listen unix://${socket}`,
      })],
      descriptors: {
        [originalIdentity.pid]: { complete: true, count: 1, highest: 3 },
      },
      controlSockets: {
        complete: true,
        items: [{ path: socket, ownerPid: originalIdentity.pid }],
      },
    });
    const runner = (file, args, options = {}) => {
      if (file === codex && args.join(" ") === "app-server daemon version") {
        return {
          status: 0,
          stdout: JSON.stringify({
            status: "running",
            backend: "pid",
            managedCodexPath: codex,
            socketPath: socket,
          }),
          stderr: "",
        };
      }
      if (file === "/usr/sbin/lsof" && args.join(" ") === "-nP -U -Fpcfn") {
        return runActual(file, [
          "-nP", "-a", "-p", String(activeIdentity.pid), "-U", "-Fpcfn",
        ], options);
      }
      if (file === "/bin/ps" && args.join(" ") === "-axo pid=,ppid=") {
        return {
          status: 0,
          stdout: `${activeIdentity.pid} ${activeIdentity.parentPid}\n`,
          stderr: "",
        };
      }
      return runActual(file, args, options);
    };
    const guardedFs = new Proxy(fs, {
      get(target, property) {
        if (property !== "unlinkSync") return Reflect.get(target, property);
        return (value) => {
          if (path.resolve(value) === socket) throw new Error("cleanup attempted socket unlink");
          return target.unlinkSync(value);
        };
      },
    });
    const dependencies = createDefaultRecycleDependencies({
      inventory: fixtureInventory,
      runner,
      fsApi: guardedFs,
      env: { CODEX_HOME: codexHome },
      uid: process.getuid(),
      signalProcess(pid, signal) {
        signalCalls.push([pid, signal]);
        throw new Error("Agent Utilities must not signal the managed server");
      },
      sleep,
      readyTimeoutMs: 2_000,
      readyPollMs: 20,
      lock: { acquire: () => () => {} },
    });
    dependencies.collectInventory = () => fixtureInventory;
    dependencies.restartManagedExact = ({ expectedIdentity }) => {
      assert.equal(expectedIdentity.pid, activeIdentity.pid);
      assert.equal(expectedIdentity.startTime, activeIdentity.startTime);
      restartCalls += 1;
      stopNativeFixture(activeIdentity);
      if (fs.existsSync(socket)) {
        fs.unlinkSync(socket);
        nativeSocketUnlinks += 1;
      }
      activeIdentity = launchServer();
      return {
        status: "restarted",
        backend: "pid",
        pid: activeIdentity.pid,
        socketPath: socket,
      };
    };
    const options = {
      platform: "darwin",
      uid: process.getuid(),
      pid: originalIdentity.pid,
      unmanaged: false,
      confirmation: null,
      attestorPath: attestor,
      minSoftLimit: 8192,
    };

    const receiptPass = recycleServer(options, dependencies);
    assert.equal(receiptPass.exitCode, EXIT_CODES.refused);
    assert.equal(receiptPass.result.verification.mutationAttempted, false);
    assert.equal(restartCalls, 0);
    const confirmation = receiptPass.result.verification.receipt.confirmationToken;

    const outcome = recycleServer({ ...options, confirmation }, dependencies);

    assert.equal(outcome.exitCode, EXIT_CODES.healthy);
    assert.equal(outcome.result.verification.complete, true);
    assert.equal(restartCalls, 1);
    assert.notEqual(activeIdentity.pid, originalIdentity.pid);
    assert.equal(exactLiveIdentity(originalIdentity.pid), null);
    assert.equal(outcome.result.verification.after.pid, activeIdentity.pid);
    assert.equal(outcome.result.verification.after.socket.ownerPid, activeIdentity.pid);
    assert.equal(outcome.result.verification.after.softNofile, 8192);
    assert.ok(outcome.result.verification.actions.some((action) => action.kind === "native-daemon-restart"));
    assert.deepEqual(signalCalls, []);
    assert.ok(nativeSocketUnlinks <= 1);
  } finally {
    for (const identity of tracked) {
      const current = exactLiveIdentity(identity.pid);
      if (sameExactIdentity(identity, current)) {
        try { process.kill(identity.pid, "SIGKILL"); } catch {}
      }
    }
    try { if (fs.existsSync(socket)) fs.unlinkSync(socket); } catch {}
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("controlled process-group canary signals only fixture identities", { timeout: 5_000 }, async () => {
  const childProgram = [
    "process.on('SIGTERM', () => {});",
    "console.log('ready');",
    "setInterval(() => {}, 1000);",
  ].join("");
  const ownerProgram = [
    "const { spawn } = require('node:child_process');",
    `const child = spawn(process.execPath, ['-e', ${JSON.stringify(childProgram)}], {stdio:['ignore','pipe','ignore']});`,
    "process.on('SIGTERM', () => {});",
    "child.once('exit', () => process.exit(0));",
    "child.stdout.once('data', () => console.log(child.pid));",
    "setInterval(() => {}, 1000);",
  ].join("");
  const owner = spawnChild(process.execPath, ["-e", ownerProgram], {
    detached: true,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const [line] = await once(owner.stdout, "data");
  const childPid = Number(String(line).trim());
  assert.ok(Number.isInteger(childPid) && childPid > 0);

  const uid = process.getuid();
  const observedOwner = collectExactProcessIdentity(owner.pid);
  const observedChild = collectExactProcessIdentity(childPid);
  assert.equal(observedOwner.state, "present");
  assert.equal(observedChild.state, "present");
  const ownerIdentity = {
    role: "server",
    ...observedOwner.identity,
    commandIdentity: "codex app-server",
  };
  const childIdentity = {
    role: "descendant",
    ...observedChild.identity,
    commandIdentity: "process",
  };
  const states = new Map([[owner.pid, ownerIdentity], [childPid, childIdentity]]);
  const signals = [];
  const dependencies = createDefaultRecycleDependencies({
    inventory: inventory(),
    uid,
    readIdentity(pid) {
      const identity = states.get(pid);
      return identity ? { state: "present", identity } : { state: "absent" };
    },
    signalProcess(pid, signal) {
      assert.ok(states.has(pid));
      const current = collectExactProcessIdentity(pid);
      assert.equal(current.state, "present");
      assert.ok(sameExactIdentity(states.get(pid), current.identity));
      signals.push([pid, signal]);
      process.kill(pid, signal);
      if (pid === owner.pid || signal === "SIGKILL") states.delete(pid);
    },
    sleep: () => {},
  });

  try {
    const outcome = dependencies.stopUnmanaged({
      owner: ownerIdentity,
      targets: [childIdentity],
    });
    assert.equal(outcome.exitCode, EXIT_CODES.healthy);
    assert.equal(outcome.mutationAttempted, true);
    assert.deepEqual(signals, [
      [childPid, "SIGTERM"],
      [owner.pid, "SIGTERM"],
      [childPid, "SIGKILL"],
    ]);
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("fixture owner survived")), 2_000);
      owner.once("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  } finally {
    for (const expected of [childIdentity, ownerIdentity]) {
      const observation = collectExactProcessIdentity(expected.pid);
      if (observation.state === "present" && sameExactIdentity(expected, observation.identity)) {
        try { process.kill(expected.pid, "SIGKILL"); } catch {}
      }
    }
  }
});
