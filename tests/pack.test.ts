import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coreIds, loadPack, loadPacks, readCoreVersion, satisfiesCaret } from "../engine/pack/load.ts";

const manifest = (over: Record<string, unknown> = {}) => ({
  schema: "numberone-pack/v1", name: "acme", version: "0.1.0", core: "^0.1", summary: "Acme pack", ...over,
});

function makePack(over: Record<string, unknown> = {}, atoms: string[] = [], flows: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "pack-"));
  writeFileSync(join(dir, "numberone-pack.json"), JSON.stringify(manifest(over)));
  for (const a of atoms) mkdirSync(join(dir, "atoms", a), { recursive: true });
  mkdirSync(join(dir, "flows"), { recursive: true });
  for (const f of flows) writeFileSync(join(dir, "flows", `${f}.flow.yaml`), "");
  return dir;
}

test("the example pack loads against the current core", () => {
  const r = loadPack(new URL("../packs/example", import.meta.url).pathname);
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.pack.manifest.name, "example");
  assert.deepEqual(r.pack.atomIds, []);
});

test("pack atoms and flows are namespaced <pack>/<id>", () => {
  const r = loadPack(makePack({}, ["merge-release"], ["ship"]), { coreVersion: "0.1.0", coreIds: new Set() });
  assert.ok(r.ok);
  assert.deepEqual(r.pack.atomIds, ["acme/merge-release"]);
  assert.deepEqual(r.pack.flowIds, ["acme/ship"]);
});

test("an atom or flow reusing a core id is rejected", () => {
  assert.ok(coreIds().has("merge-pr"));
  const atom = loadPack(makePack({}, ["merge-pr"]), { coreVersion: "0.1.0" });
  assert.ok(!atom.ok);
  assert.match(atom.errors[0], /shadows core id merge-pr/);
  const flow = loadPack(makePack({}, [], ["pr-to-done"]), { coreVersion: "0.1.0" });
  assert.ok(!flow.ok);
  assert.match(flow.errors[0], /shadows core id pr-to-done/);
});

test("a core range that excludes the core version is rejected", () => {
  const r = loadPack(makePack({ core: "^0.2" }), { coreVersion: "0.1.0" });
  assert.ok(!r.ok);
  assert.equal(r.errors[0], "pack acme needs core ^0.2, but core is 0.1.0");
  assert.ok(!loadPack(makePack({ core: "^1.x" })).ok);
});

test("an invalid manifest is rejected", () => {
  assert.ok(!loadPack(makePack({ core: ">=0.1 <0.2" })).ok);
  assert.ok(!loadPack(makePack({ name: "Acme/x" })).ok);
  assert.ok(!loadPack(makePack({ extra: 1 })).ok);
  assert.ok(!loadPack(join(tmpdir(), "no-such-pack")).ok);
});

test("caret ranges follow npm semantics", () => {
  const cases: [string, string, boolean][] = [
    ["0.0.0", "^0.x", true], ["0.9.9", "^0.x", true], ["1.0.0", "^0.x", false],
    ["0.1.0", "^0.1", true], ["0.1.9", "^0.1", true], ["0.2.0", "^0.1", false], ["0.0.9", "^0.1", false],
    ["0.1.2", "^0.1.2", true], ["0.1.1", "^0.1.2", false], ["0.1.9", "^0.1.2", true], ["0.2.0", "^0.1.2", false],
    ["0.0.3", "^0.0.3", true], ["0.0.4", "^0.0.3", false],
    ["1.0.0", "^1.x", true], ["1.9.0", "^1.x", true], ["2.0.0", "^1.x", false], ["0.9.0", "^1.x", false],
    ["1.2.3", "^1.2", true], ["1.1.9", "^1.2", false],
  ];
  for (const [v, range, want] of cases) assert.equal(satisfiesCaret(v, range), want, `${v} in ${range}`);
  assert.equal(satisfiesCaret("0.1.0", "~0.1"), false);
  assert.equal(satisfiesCaret("0.1", "^0.1"), false);
});

test("core version comes from package.json", () => {
  assert.match(readCoreVersion(), /^\d+\.\d+\.\d+$/);
});

test("a local path override replaces an installed pack of the same name", () => {
  const installed = makePack({ version: "0.1.0" }, ["old"]);
  const local = makePack({ version: "0.2.0" }, ["new"]);
  const r = loadPacks([installed], [local], { coreVersion: "0.1.0", coreIds: new Set() });
  assert.deepEqual(r.errors, []);
  assert.equal(r.packs.length, 1);
  assert.equal(r.packs[0].manifest.version, "0.2.0");
  assert.deepEqual(r.packs[0].atomIds, ["acme/new"]);
});

test("loadPacks reports a duplicate name within one layer and keeps going", () => {
  const r = loadPacks([makePack(), makePack()], [], { coreVersion: "0.1.0", coreIds: new Set() });
  assert.deepEqual(r.errors, ["installed packs name acme twice"]);
});
