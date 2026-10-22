import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";

const engineDir = join(import.meta.dirname, "..", "engine");

const modules = (readdirSync(engineDir, { recursive: true }) as string[])
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
  .sort();

test("engine has modules to import", () => {
  assert.ok(modules.length > 0);
});

for (const file of modules) {
  test(`engine/${file} imports`, async () => {
    const url = pathToFileURL(join(engineDir, file)).href;
    const mod = await import(url);
    assert.equal(typeof mod, "object", relative(engineDir, file));
  });
}
