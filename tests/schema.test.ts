import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRegistry, checkSchema, formatError, validate, type Registry, type Schema } from "../engine/schema/validate.ts";
import { generate } from "../tools/gen-types.ts";

const errorsOf = (schema: Schema, value: unknown, registry?: Registry): string[] => {
  const r = validate(schema, value, registry);
  return r.ok ? [] : r.errors.map(formatError);
};
const valueOf = (schema: Schema, value: unknown, registry?: Registry): unknown => {
  const r = validate(schema, value, registry);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};

test("type accepts matching values and names the expected type", () => {
  assert.deepEqual(errorsOf({ type: "string" }, "x"), []);
  assert.deepEqual(errorsOf({ type: "string" }, 1), ["/: expected string"]);
  assert.deepEqual(errorsOf({ type: "integer" }, 2), []);
  assert.deepEqual(errorsOf({ type: "integer" }, 2.5), ["/: expected integer"]);
  assert.deepEqual(errorsOf({ type: "number" }, 2.5), []);
  assert.deepEqual(errorsOf({ type: "boolean" }, "true"), ["/: expected boolean"]);
  assert.deepEqual(errorsOf({ type: "null" }, null), []);
  assert.deepEqual(errorsOf({ type: "object" }, []), ["/: expected object"]);
  assert.deepEqual(errorsOf({ type: "array" }, {}), ["/: expected array"]);
  assert.deepEqual(errorsOf({ type: ["string", "null"] }, null), []);
  assert.deepEqual(errorsOf({ type: ["string", "null"] }, 3), ["/: expected string or null"]);
});

test("properties report errors at the nested JSON pointer", () => {
  const schema: Schema = {
    type: "object",
    properties: { params: { type: "object", properties: { to: { type: "string" } } } },
  };
  assert.deepEqual(errorsOf(schema, { params: { to: "review" } }), []);
  assert.deepEqual(errorsOf(schema, { params: { to: 7 } }), ["/params/to: expected string"]);
});

test("pointer segments escape ~ and /", () => {
  const schema: Schema = { properties: { "a/b": { type: "string" }, "c~d": { type: "string" } } };
  assert.deepEqual(errorsOf(schema, { "a/b": 1, "c~d": 2 }), ["/a~1b: expected string", "/c~0d: expected string"]);
});

test("required reports each missing property", () => {
  const schema: Schema = { type: "object", required: ["atom", "schema"], properties: { atom: { type: "string" } } };
  assert.deepEqual(errorsOf(schema, { atom: "pr-ready", schema: "numberone-atom/v1" }), []);
  assert.deepEqual(errorsOf(schema, {}), ["/atom: missing required property", "/schema: missing required property"]);
});

test("additionalProperties false rejects unknown keys; a schema validates them", () => {
  const closed: Schema = { type: "object", properties: { a: { type: "string" } }, additionalProperties: false };
  assert.deepEqual(errorsOf(closed, { a: "x" }), []);
  assert.deepEqual(errorsOf(closed, { a: "x", b: 1 }), ["/b: unexpected property"]);
  const map: Schema = { type: "object", additionalProperties: { type: "integer" } };
  assert.deepEqual(errorsOf(map, { x: 1, y: 2 }), []);
  assert.deepEqual(errorsOf(map, { x: 1, y: "2" }), ["/y: expected integer"]);
});

test("items validates every element", () => {
  const schema: Schema = { type: "object", properties: { list: { type: "array", items: { type: "string" } } } };
  assert.deepEqual(errorsOf(schema, { list: ["a", "b"] }), []);
  assert.deepEqual(errorsOf(schema, { list: ["a", 2, "c", null] }), ["/list/1: expected string", "/list/3: expected string"]);
});

test("enum and const compare JSON values deeply", () => {
  const layer: Schema = { enum: ["code", "jev", "haiku", "llm"] };
  assert.deepEqual(errorsOf(layer, "jev"), []);
  assert.deepEqual(errorsOf(layer, "gpt"), ['/: expected one of "code", "jev", "haiku", "llm"']);
  const exact: Schema = { const: { kind: "github", n: [1, 2] } };
  assert.deepEqual(errorsOf(exact, { n: [1, 2], kind: "github" }), []);
  assert.deepEqual(errorsOf(exact, { kind: "github", n: [2, 1] }), ['/: expected {"kind":"github","n":[1,2]}']);
  assert.deepEqual(errorsOf({ const: "numberone/v1" }, "numberone/v2"), ['/: expected "numberone/v1"']);
});

test("pattern applies to strings only and a bad pattern is an error, not a throw", () => {
  const secret: Schema = { pattern: "^(env|cmd|keychain):" };
  assert.deepEqual(errorsOf(secret, "env:GH_TOKEN"), []);
  assert.deepEqual(errorsOf(secret, "ghp_abc"), ["/: does not match pattern ^(env|cmd|keychain):"]);
  assert.deepEqual(errorsOf(secret, 42), []);
  assert.deepEqual(errorsOf({ pattern: "(" }, "x"), ["/: invalid pattern ("]);
});

const expires: Schema = {
  oneOf: [
    { const: "run-end" },
    { type: "object", required: ["at"], properties: { at: { type: "string" } }, additionalProperties: false },
    { type: "object", required: ["stage"], properties: { stage: { type: "string" } }, additionalProperties: false },
  ],
};

test("oneOf passes when exactly one branch matches", () => {
  assert.deepEqual(errorsOf(expires, "run-end"), []);
  assert.deepEqual(errorsOf(expires, { stage: "done" }), []);
});

test("oneOf fails on zero matches with each branch's first error", () => {
  assert.deepEqual(errorsOf(expires, { at: 5 }), [
    '/: matches no oneOf branch: [0] /: expected "run-end"; [1] /at: expected string; [2] /stage: missing required property',
  ]);
});

test("oneOf fails when more than one branch matches", () => {
  const schema: Schema = { oneOf: [{ type: "string" }, { pattern: "^a" }] };
  assert.deepEqual(errorsOf(schema, "abc"), ["/: matches 2 oneOf branches (0, 1), expected exactly one"]);
});

test("local $ref resolves into $defs, alongside sibling keywords", () => {
  const schema: Schema = {
    type: "object",
    properties: { pr: { $ref: "#/$defs/pr-ref" } },
    $defs: { "pr-ref": { type: "string", pattern: "^[\\w-]+/[\\w-]+#\\d+$" } },
  };
  assert.deepEqual(errorsOf(schema, { pr: "acme/app#101" }), []);
  assert.deepEqual(errorsOf(schema, { pr: "app 101" }), ["/pr: does not match pattern ^[\\w-]+/[\\w-]+#\\d+$"]);
  assert.deepEqual(errorsOf({ $ref: "#/$defs/s", const: "b", $defs: { s: { type: "string" } } }, "a"), ['/: expected "b"']);
});

test("numberone: ids resolve through the registry, with or without a fragment", () => {
  const common: Schema = {
    $id: "numberone:common",
    $defs: {
      "pr-ref": { $id: "numberone:pr-ref", type: "string" },
      login: { type: "string", pattern: "^[a-z-]+$" },
      people: { type: "array", items: { $ref: "#/$defs/login" } },
    },
  };
  const { registry, errors } = buildRegistry([common]);
  assert.deepEqual(errors, []);
  assert.deepEqual([...registry.keys()], ["numberone:common", "numberone:pr-ref"]);
  assert.deepEqual(errorsOf({ $ref: "numberone:pr-ref" }, 101, registry), ["/: expected string"]);
  assert.deepEqual(errorsOf({ $ref: "numberone:common#/$defs/people" }, ["ada-example", "QA"], registry), [
    "/1: does not match pattern ^[a-z-]+$",
  ]);
});

test("unresolvable refs and ref cycles come back as errors", () => {
  assert.deepEqual(errorsOf({ $ref: "numberone:nope" }, 1), ["/: unknown schema id numberone:nope"]);
  assert.deepEqual(errorsOf({ $ref: "#/$defs/nope" }, 1), ["/: $ref #/$defs/nope points at nothing"]);
  assert.deepEqual(errorsOf({ $ref: "https://example.com/x.json" }, 1), [
    "/: unsupported $ref https://example.com/x.json: only #/... and numberone: ids resolve",
  ]);
  assert.deepEqual(errorsOf({ $ref: "#/$defs/a", $defs: { a: { $ref: "#/$defs/a" } } }, 1), [
    "/: schema nests too deep; is there a $ref cycle?",
  ]);
});

test("buildRegistry reports duplicate ids", () => {
  const { errors } = buildRegistry([{ $id: "numberone:x" }, { $defs: { y: { $id: "numberone:x" } } }]);
  assert.deepEqual(errors.map(formatError), ["/$defs/y/$id: duplicate id numberone:x"]);
});

test("defaults fill missing properties without touching the input", () => {
  const schema: Schema = {
    type: "object",
    required: ["poll"],
    properties: {
      poll: { type: "string", default: "60s" },
      budget: { type: "object", default: {}, properties: { tokens: { type: "integer", default: 0 } } },
      tags: { type: "array", default: ["a"] },
    },
  };
  const input = { budget: {} };
  assert.deepEqual(valueOf(schema, input), { budget: { tokens: 0 }, poll: "60s", tags: ["a"] });
  assert.deepEqual(input, { budget: {} });
  assert.deepEqual(valueOf(schema, { poll: "5m", budget: { tokens: 9 }, tags: [] }), { poll: "5m", budget: { tokens: 9 }, tags: [] });
});

test("default values are copies, not shared references", () => {
  const schema: Schema = { properties: { list: { default: [] } } };
  const a = valueOf(schema, {}) as { list: unknown[] };
  a.list.push(1);
  assert.deepEqual(valueOf(schema, {}), { list: [] });
});

test("defaults come only from the oneOf branch that matched", () => {
  const schema: Schema = {
    oneOf: [
      { type: "object", required: ["kind"], properties: { kind: { const: "dm" }, mode: { default: "canvas" } } },
      { type: "object", required: ["kind"], properties: { kind: { const: "channel" }, mode: { default: "direct" } } },
    ],
  };
  assert.deepEqual(valueOf(schema, { kind: "channel" }), { kind: "channel", mode: "direct" });
});

test("bad schemas never throw", () => {
  assert.deepEqual(errorsOf(5 as unknown as Schema, "x"), ["/: invalid schema: expected an object or a boolean"]);
  assert.deepEqual(errorsOf(false, "x"), ["/: no value is allowed here"]);
  assert.deepEqual(errorsOf(true, "x"), []);
});

test("checkSchema flags keywords outside the subset and refs that do not resolve", () => {
  const schema = {
    type: "object",
    properties: { n: { type: "integer", minimum: 0 }, s: { type: "text" }, r: { $ref: "#/$defs/gone" }, p: { pattern: "[" } },
  } as unknown as Schema;
  assert.deepEqual(checkSchema(schema).map(formatError), [
    "/properties/n/minimum: unsupported keyword",
    '/properties/s/type: unknown type "text"',
    "/properties/r/$ref: $ref #/$defs/gone points at nothing",
    "/properties/p/pattern: invalid pattern [",
  ]);
  assert.deepEqual(checkSchema(expires), []);
});

test("generate writes one types file per schema and the barrel", () => {
  const out = generate([
    {
      file: "grant.v1.json",
      schema: {
        type: "object",
        required: ["id", "status"],
        additionalProperties: false,
        properties: {
          id: { type: "string" },
          status: { enum: ["pending", "approved"] },
          expires: { $ref: "#/$defs/expiry" },
          pr: { $ref: "numberone:pr-ref" },
          retries: { type: "integer", default: 0 },
          "x-tags": { type: "array", items: { type: ["string", "null"] } },
        },
        $defs: { expiry: { oneOf: [{ const: "run-end" }, { type: "object", properties: { at: { type: "string" } } }] } },
      },
    },
    { file: "common.v1.json", schema: { $defs: { "pr-ref": { $id: "numberone:pr-ref", type: "string" } } } },
  ]);
  assert.deepEqual([...out.keys()], ["engine/types/common.gen.ts", "engine/types/grant.gen.ts", "engine/types.ts"]);
  assert.equal(
    out.get("engine/types/grant.gen.ts"),
    [
      "// generated from schemas/grant.v1.json by tools/gen-types.ts, do not edit",
      'import type { PrRef } from "./common.gen.ts";',
      "",
      "export type Grant = {",
      "  id: string;",
      '  status: "pending" | "approved";',
      "  expires?: Expiry;",
      "  pr?: PrRef;",
      "  retries: number;",
      '  "x-tags"?: Array<string | null>;',
      "};",
      'export type Expiry = "run-end" | {',
      "  at?: string;",
      "  [key: string]: unknown;",
      "};",
      "",
    ].join("\n"),
  );
  assert.equal(
    out.get("engine/types.ts"),
    [
      "// generated by tools/gen-types.ts, do not edit",
      'export type * from "./types/common.gen.ts";',
      'export type * from "./types/grant.gen.ts";',
      "",
    ].join("\n"),
  );
});

test("generate refuses schemas it cannot type", () => {
  assert.throws(
    () => generate([
      { file: "a.v1.json", schema: { $defs: { b: { type: "string" } } } },
      { file: "b.v1.json", schema: { type: "integer", minimum: 1 } as unknown as Schema },
    ]),
    { message: "b.v1.json: /minimum: unsupported keyword\nb.v1.json: type B is also exported by a.v1.json" },
  );
});
