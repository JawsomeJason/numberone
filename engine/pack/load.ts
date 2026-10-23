// Loads a pack manifest, checks it against the core version, and names its ids `<pack>/<id>`.
// Never throws: every failure comes back as a message.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSchema, formatError, validate, type Schema } from "../schema/validate.ts";
import type { Pack } from "../types/pack.gen.ts";

export type { Pack };

export type LoadedPack = {
  /** Directory the pack was read from. */
  dir: string;
  manifest: Pack;
  /** `<pack>/<id>` for each atom and flow the pack ships. */
  atomIds: string[];
  flowIds: string[];
};

export type PackResult = { ok: true; pack: LoadedPack } | { ok: false; errors: string[] };

export type LoadPackOptions = {
  /** Core version, x.y.z. Defaults to the version in the repo's package.json. */
  coreVersion?: string;
  /** Core atom and flow ids a pack may not shadow. Defaults to the repo's atoms/ and flows/. */
  coreIds?: ReadonlySet<string>;
};

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MANIFEST = "numberone-pack.json";

const readJson = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"));
const packSchema = (): Schema => readJson(join(ROOT, "schemas/pack.v1.json")) as Schema;

type Version = [number, number, number];

const parseVersion = (v: string): Version | undefined => {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
};

const compare = (a: Version, b: Version): number => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** The `[lower, upper)` bounds of a caret range with npm semantics, or undefined when it is malformed. */
export function caretBounds(range: string): { lower: Version; upper: Version } | undefined {
  const m = /^\^(\d+)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?$/.exec(range.trim());
  if (!m) return undefined;
  const num = (s: string | undefined): number | undefined => (s === undefined || /^[xX*]$/.test(s) ? undefined : Number(s));
  const major = Number(m[1]);
  const minor = num(m[2]);
  const patch = minor === undefined ? undefined : num(m[3]);
  const lower: Version = [major, minor ?? 0, patch ?? 0];
  let upper: Version;
  if (major > 0) upper = [major + 1, 0, 0];
  else if (minor === undefined) upper = [1, 0, 0];
  else if (minor > 0 || patch === undefined) upper = [0, minor + 1, 0];
  else upper = [0, 0, patch + 1];
  return { lower, upper };
}

/** True when `version` (x.y.z) satisfies the caret `range` (^0.x, ^0.1, ^0.1.2, ^1.x). */
export function satisfiesCaret(version: string, range: string): boolean {
  const v = parseVersion(version);
  const b = caretBounds(range);
  return v !== undefined && b !== undefined && compare(v, b.lower) >= 0 && compare(v, b.upper) < 0;
}

export const readCoreVersion = (root: string = ROOT): string =>
  (readJson(join(root, "package.json")) as { version: string }).version;

/** Ids of the core atoms (`atoms/<id>/`) and flows (`flows/<id>.flow.yaml`). */
export function coreIds(root: string = ROOT): Set<string> {
  const ids = new Set<string>();
  idsIn(join(root, "atoms"), "atoms").forEach((i) => ids.add(i));
  idsIn(join(root, "flows"), "flows").forEach((i) => ids.add(i));
  return ids;
}

function idsIn(dir: string, kind: "atoms" | "flows"): string[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return kind === "atoms"
    ? entries.filter((e) => e.isDirectory()).map((e) => e.name)
    : entries.filter((e) => e.isFile() && e.name.endsWith(".flow.yaml")).map((e) => e.name.slice(0, -".flow.yaml".length));
}

/**
 * Loads the pack at `dir` (an installed plugin's root, or a local path from `config.packs`).
 * Rejects an invalid manifest, a `core` range that excludes the core version, and any pack
 * atom or flow whose bare id is also a core id.
 */
export function loadPack(dir: string, options: LoadPackOptions = {}): PackResult {
  const file = join(dir, MANIFEST);
  let raw: unknown;
  try {
    raw = readJson(file);
  } catch (e) {
    return { ok: false, errors: [`${file}: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const schema = packSchema();
  const bad = checkSchema(schema);
  if (bad.length > 0) return { ok: false, errors: bad.map(formatError) };
  const checked = validate(schema, raw);
  if (!checked.ok) return { ok: false, errors: checked.errors.map((e) => `${file}${formatError(e)}`) };
  const manifest = checked.value as Pack;

  const errors: string[] = [];
  const core = options.coreVersion ?? readCoreVersion();
  if (!satisfiesCaret(core, manifest.core)) {
    errors.push(`pack ${manifest.name} needs core ${manifest.core}, but core is ${core}`);
  }
  const shadowable = options.coreIds ?? coreIds();
  const atoms = idsIn(join(dir, "atoms"), "atoms");
  const flows = idsIn(join(dir, "flows"), "flows");
  for (const id of [...atoms, ...flows]) {
    if (shadowable.has(id)) errors.push(`pack ${manifest.name} shadows core id ${id}; pack ids are ${manifest.name}/<id> and may not reuse a core id`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    pack: {
      dir,
      manifest,
      atomIds: atoms.map((id) => `${manifest.name}/${id}`),
      flowIds: flows.map((id) => `${manifest.name}/${id}`),
    },
  };
}

/**
 * Loads every pack path in order. A local path replaces an installed pack of the same name,
 * so `overrides` (development paths) win over `installed` (plugin roots). Duplicate names within
 * one list are errors.
 */
export function loadPacks(installed: string[], overrides: string[] = [], options: LoadPackOptions = {}): { packs: LoadedPack[]; errors: string[] } {
  const byName = new Map<string, LoadedPack>();
  const errors: string[] = [];
  for (const [layer, dirs] of [["installed", installed], ["override", overrides]] as const) {
    const seen = new Set<string>();
    for (const dir of dirs) {
      const r = loadPack(dir, options);
      if (!r.ok) {
        errors.push(...r.errors);
        continue;
      }
      const name = r.pack.manifest.name;
      if (seen.has(name)) errors.push(`${layer} packs name ${name} twice`);
      seen.add(name);
      byName.set(name, r.pack);
    }
  }
  return { packs: [...byName.values()], errors };
}
