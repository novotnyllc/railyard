import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const lifecycle = path.join(__dirname, "route-lifecycle.js");
const rs = await import("./route-state.js");

test("debug lifecycle", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "dbg-lc-"));
  process.env.RAILYARD_ROUTE_STATE_DIR = dir;
  console.log("state dir:", dir);

  const route = rs.createRoute({});
  console.log("files after create:", readdirSync(dir));
  console.log("route state:", route.state);

  const r = spawnSync(process.execPath, [lifecycle, "start"], {
    input: JSON.stringify({ agent_id: "a1" }),
    encoding: "utf8",
    env: { ...process.env },
  });
  console.log("exit code:", r.status);
  console.log("stdout:", (r.stdout || "").slice(0, 200));
  console.log("stderr:", (r.stderr || "").slice(0, 500));
  const updated = rs.readRoute(route.route_id);
  console.log("after state:", updated ? updated.state : "NOT FOUND");
  rmSync(dir, { recursive: true, force: true });
});
