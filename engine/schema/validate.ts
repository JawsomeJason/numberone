// Validator for the JSON Schema 2020-12 subset numberone's schemas use.
// validate() never throws: bad documents and bad schemas both come back as errors.

export type TypeName = "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";

export type Schema = boolean | SchemaObject;

export type SchemaObject = {
  $schema?: string;
  $id?: string;
  $ref?: string;
  $defs?: Record<string, Schema>;
  $comment?: string;
  title?: string;
  description?: string;
  examples?: unknown[];
  default?: unknown;
  type?: TypeName | TypeName[];
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: Schema;
  items?: Schema;
  enum?: unknown[];
  const?: unknown;
  pattern?: string;
  oneOf?: Schema[];
};

/** Schemas addressable by `numberone:` id, from buildRegistry. */
export type Registry = ReadonlyMap<string, Schema>;

/** `path` is a JSON pointer into the document (or into the schema, for checkSchema). */
export type ValidationError = { path: string; message: string };

export type Validation = { ok: true; value: unknown } | { ok: false; errors: ValidationError[] };

const KEYWORDS = new Set([
  "$schema", "$id", "$ref", "$defs", "$comment", "title", "description", "examples", "default",
  "type", "required", "properties", "additionalProperties", "items", "enum", "const", "pattern", "oneOf",
]);
const TYPES = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const MAX_DEPTH = 256;
const EMPTY: Registry = new Map();

export const formatError = (e: ValidationError): string => `${e.path || "/"}: ${e.message}`;

export const pointerJoin = (path: string, key: string | number): string =>
  `${path}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;

/**
 * Checks `value` against `schema` and returns a copy with every missing property that has a
 * `default` filled in. Defaults are applied before `required` is checked.
 */
export function validate(schema: Schema, value: unknown, registry: Registry = EMPTY): Validation {
  const errors: ValidationError[] = [];
  const out = visit(schema, value, "", schema, registry, errors, 0);
  return errors.length === 0 ? { ok: true, value: out } : { ok: false, errors };
}

/** Indexes every subschema whose `$id` starts with `numberone:`. Duplicate ids are errors. */
export function buildRegistry(schemas: Schema[]): { registry: Registry; errors: ValidationError[] } {
  const registry = new Map<string, Schema>();
  const errors: ValidationError[] = [];
  for (const root of schemas) {
    walk(root, "", (node, path) => {
      if (!isObject(node) || typeof node.$id !== "string" || !node.$id.startsWith("numberone:")) return;
      if (registry.has(node.$id)) errors.push({ path: pointerJoin(path, "$id"), message: `duplicate id ${node.$id}` });
      else registry.set(node.$id, node);
    });
  }
  return { registry, errors };
}

/** Reports keywords outside the subset, bad types, unresolvable `$ref`s and patterns that do not compile. */
export function checkSchema(schema: Schema, registry: Registry = EMPTY): ValidationError[] {
  const errors: ValidationError[] = [];
  walk(schema, "", (node, path, root) => {
    if (typeof node === "boolean") return;
    if (!isObject(node)) {
      errors.push({ path, message: "expected a schema (an object or a boolean)" });
      return;
    }
    const err = (key: string, message: string) => errors.push({ path: pointerJoin(path, key), message });
    for (const key of Object.keys(node)) if (!KEYWORDS.has(key)) err(key, "unsupported keyword");
    const types = node.type === undefined ? [] : Array.isArray(node.type) ? node.type : [node.type];
    for (const t of types) if (!TYPES.has(t)) err("type", `unknown type ${JSON.stringify(t)}`);
    if (node.required !== undefined && !(Array.isArray(node.required) && node.required.every((k) => typeof k === "string"))) {
      err("required", "expected an array of strings");
    }
    if (node.enum !== undefined && !Array.isArray(node.enum)) err("enum", "expected an array");
    if (node.oneOf !== undefined && !Array.isArray(node.oneOf)) err("oneOf", "expected an array");
    const re = node.pattern === undefined ? undefined : regex(node.pattern);
    if (typeof re === "string") err("pattern", re);
    const target = node.$ref === undefined ? undefined : resolveRef(node.$ref, root, registry);
    if (typeof target === "string") err("$ref", target);
  });
  return errors;
}

function visit(schema: unknown, value: unknown, path: string, root: Schema, registry: Registry, errors: ValidationError[], depth: number): unknown {
  const fail = (message: string, at = path) => {
    errors.push({ path: at, message });
    return value;
  };
  if (depth > MAX_DEPTH) return fail("schema nests too deep; is there a $ref cycle?");
  if (schema === true) return value;
  if (schema === false) return fail("no value is allowed here");
  if (!isObject(schema)) return fail("invalid schema: expected an object or a boolean");
  const s = schema as SchemaObject;
  if (typeof s.$id === "string") root = s;
  let out = value;

  if (s.$ref !== undefined) {
    const target = resolveRef(s.$ref, root, registry);
    if (typeof target === "string") return fail(target);
    out = visit(target.schema, out, path, target.root, registry, errors, depth + 1);
  }

  if (s.type !== undefined) {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (!types.some((t) => hasType(out, t))) return fail(`expected ${types.join(" or ")}`);
  }
  if (s.const !== undefined && !jsonEqual(out, s.const)) fail(`expected ${JSON.stringify(s.const)}`);
  if (Array.isArray(s.enum) && !s.enum.some((e) => jsonEqual(out, e))) {
    fail(`expected one of ${s.enum.map((e) => JSON.stringify(e)).join(", ")}`);
  }
  if (s.pattern !== undefined && typeof out === "string") {
    const re = regex(s.pattern);
    if (typeof re === "string") fail(re);
    else if (!re.test(out)) fail(`does not match pattern ${s.pattern}`);
  }

  if (isObject(out)) {
    const obj: Record<string, unknown> = { ...out };
    const props = isObject(s.properties) ? (s.properties as Record<string, Schema>) : {};
    for (const [key, sub] of Object.entries(props)) {
      if (!(key in obj) && isObject(sub) && "default" in sub) obj[key] = structuredClone((sub as SchemaObject).default);
    }
    for (const key of Array.isArray(s.required) ? s.required : []) {
      if (!(key in obj)) fail("missing required property", pointerJoin(path, key));
    }
    for (const key of Object.keys(obj)) {
      const at = pointerJoin(path, key);
      if (Object.hasOwn(props, key)) obj[key] = visit(props[key], obj[key], at, root, registry, errors, depth + 1);
      else if (s.additionalProperties === false) fail("unexpected property", at);
      else if (s.additionalProperties !== undefined) obj[key] = visit(s.additionalProperties, obj[key], at, root, registry, errors, depth + 1);
    }
    out = obj;
  }

  if (Array.isArray(out) && s.items !== undefined) {
    out = out.map((item, i) => visit(s.items, item, pointerJoin(path, i), root, registry, errors, depth + 1));
  }

  if (Array.isArray(s.oneOf)) {
    const passed: { index: number; value: unknown }[] = [];
    const firstErrors: string[] = [];
    s.oneOf.forEach((branch, index) => {
      const branchErrors: ValidationError[] = [];
      const branchValue = visit(branch, out, path, root, registry, branchErrors, depth + 1);
      if (branchErrors.length === 0) passed.push({ index, value: branchValue });
      else firstErrors.push(`[${index}] ${formatError(branchErrors[0])}`);
    });
    if (passed.length === 1) out = passed[0].value;
    else if (passed.length === 0) fail(`matches no oneOf branch: ${firstErrors.join("; ")}`);
    else fail(`matches ${passed.length} oneOf branches (${passed.map((p) => p.index).join(", ")}), expected exactly one`);
  }

  return out;
}

function resolveRef(ref: unknown, root: Schema, registry: Registry): { schema: Schema; root: Schema } | string {
  if (typeof ref !== "string") return "$ref must be a string";
  const hash = ref.indexOf("#");
  const id = hash === -1 ? ref : ref.slice(0, hash);
  const fragment = hash === -1 ? "" : ref.slice(hash + 1);
  let base = root;
  if (id !== "") {
    if (!id.startsWith("numberone:")) return `unsupported $ref ${ref}: only #/... and numberone: ids resolve`;
    const found = registry.get(id);
    if (found === undefined) return `unknown schema id ${id}`;
    base = found;
  }
  const schema = resolvePointer(base, fragment);
  if (schema === undefined) return `$ref ${ref} points at nothing`;
  return { schema: schema as Schema, root: base };
}

function resolvePointer(doc: unknown, pointer: string): unknown {
  if (pointer === "") return doc;
  if (!pointer.startsWith("/")) return undefined;
  let node = doc;
  for (const raw of pointer.slice(1).split("/")) {
    let key: string;
    try {
      key = decodeURIComponent(raw).replaceAll("~1", "/").replaceAll("~0", "~");
    } catch {
      return undefined;
    }
    if (!(isObject(node) || Array.isArray(node)) || !Object.hasOwn(node as object, key)) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/** Calls `fn` on every subschema, with the resource root (nearest `$id`) its local refs resolve against. */
function walk(schema: unknown, path: string, fn: (node: unknown, path: string, root: Schema) => void, root?: Schema, depth = 0): void {
  if (depth > MAX_DEPTH) return;
  if (!isObject(schema)) {
    fn(schema, path, root ?? false);
    return;
  }
  const node = schema as SchemaObject;
  if (typeof node.$id === "string" || root === undefined) root = node;
  fn(node, path, root);
  const child = (sub: unknown, at: string) => {
    if (sub !== undefined) walk(sub, at, fn, root, depth + 1);
  };
  for (const key of ["$defs", "properties"] as const) {
    const map = node[key];
    if (isObject(map)) for (const [name, sub] of Object.entries(map)) child(sub, pointerJoin(pointerJoin(path, key), name));
  }
  child(node.additionalProperties, pointerJoin(path, "additionalProperties"));
  child(node.items, pointerJoin(path, "items"));
  if (Array.isArray(node.oneOf)) node.oneOf.forEach((sub, i) => child(sub, pointerJoin(pointerJoin(path, "oneOf"), i)));
}

const regexCache = new Map<string, RegExp | string>();

function regex(pattern: unknown): RegExp | string {
  if (typeof pattern !== "string") return "pattern must be a string";
  let re = regexCache.get(pattern);
  if (re === undefined) {
    try {
      re = new RegExp(pattern, "u");
    } catch {
      re = `invalid pattern ${pattern}`;
    }
    regexCache.set(pattern, re);
  }
  return re;
}

function hasType(value: unknown, type: TypeName): boolean {
  switch (type) {
    case "object": return isObject(value);
    case "array": return Array.isArray(value);
    case "string": return typeof value === "string";
    case "number": return typeof value === "number" && Number.isFinite(value);
    case "integer": return Number.isInteger(value);
    case "boolean": return typeof value === "boolean";
    case "null": return value === null;
    default: return false;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => jsonEqual(x, b[i]));
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every((k) => Object.hasOwn(b, k) && jsonEqual(a[k], b[k]));
  }
  return false;
}
