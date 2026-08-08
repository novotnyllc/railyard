import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  DEFAULT_THRESHOLDS,
  EXIT_CODES,
  classifyInventory,
  collectExactProcessIdentity,
  collectMacOSInventory,
  parseCliArgs,
  renderHuman,
} from "./cleanup-codex.mjs";

import {
  NOW,
  guiFixture,
  inventory,
  processRecord,
} from "./test-support.mjs";

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
