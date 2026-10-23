import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFencedBlock, parseFrontmatter, parseYaml } from "../engine/yaml.ts";

test("parseYaml reads maps, lists, scalars and nested values", () => {
  const result = parseYaml("name: ada-example\ncount: 3\nok: true\nnothing: null\ntags: [a, b]\nnested:\n  - id: 1\n    path: /x\n");
  assert.deepEqual(result, {
    ok: true,
    value: { name: "ada-example", count: 3, ok: true, nothing: null, tags: ["a", "b"], nested: [{ id: 1, path: "/x" }] },
  });
});

test("parseYaml keeps YAML 1.2 core typing: yes and 010 are not coerced", () => {
  assert.deepEqual(parseYaml("a: yes\nb: 010\nc: '1'\n"), { ok: true, value: { a: "yes", b: 10, c: "1" } });
});

test("parseYaml returns null for an empty document", () => {
  assert.deepEqual(parseYaml(""), { ok: true, value: null });
});

test("parseYaml reports malformed YAML with its line, without throwing", () => {
  const result = parseYaml("a: [1, 2\nb: 3");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.startsWith("Flow sequence in block collection must be sufficiently indented"));
  assert.ok(!result.ok && result.error.includes("at line 2, column 1"));
});

test("parseYaml rejects duplicate keys", () => {
  const result = parseYaml("a: 1\na: 2\n");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.startsWith("Map keys must be unique"));
});

test("parseYaml rejects tabs used as indentation", () => {
  assert.equal(parseYaml("a:\n\tb: 1\n").ok, false);
});

const atom = [
  "---",
  "name: pr-ready",
  "layer: code",
  "---",
  "",
  "# pr-ready",
  "",
  "status: this line is prose, not YAML",
  "",
].join("\n");

test("parseFrontmatter reads the top block and ignores the body", () => {
  assert.deepEqual(parseFrontmatter(atom), { ok: true, value: { name: "pr-ready", layer: "code" } });
});

test("parseFrontmatter accepts CRLF line endings and a BOM", () => {
  assert.deepEqual(parseFrontmatter("\uFEFF---\r\nname: x\r\n---\r\nbody\r\n"), { ok: true, value: { name: "x" } });
});

test("parseFrontmatter treats an empty block as null", () => {
  assert.deepEqual(parseFrontmatter("---\n---\nbody"), { ok: true, value: null });
});

test("parseFrontmatter fails when the file does not start with ---", () => {
  assert.deepEqual(parseFrontmatter("\n---\nname: x\n---\n"), {
    ok: false,
    error: "no frontmatter: the file must start with a --- line",
  });
  assert.equal(parseFrontmatter("").ok, false);
});

test("parseFrontmatter fails when the block never closes", () => {
  assert.deepEqual(parseFrontmatter("---\nname: x\n"), {
    ok: false,
    error: "unterminated frontmatter: no closing --- line",
  });
});

test("parseFrontmatter reports malformed YAML inside the block", () => {
  const result = parseFrontmatter("---\nname: [oops\n---\nbody\n");
  assert.equal(result.ok, false);
});

const config = [
  "# numberone config",
  "",
  "Prose before the block. It mentions `schema: numberone/v1` and a line below:",
  "",
  "mode: not-yaml",
  "",
  "```yaml",
  "# an unrelated example",
  "schema: other/v9",
  "mode: wrong",
  "```",
  "",
  "```json",
  '{"schema": "numberone/v1"}',
  "```",
  "",
  "````text",
  "```yaml",
  "schema: numberone/v1",
  "mode: inside-a-longer-fence",
  "```",
  "````",
  "",
  "```yaml",
  "schema: numberone/v1",
  "mode: real",
  "items:",
  "  - one",
  "  - two",
  "```",
  "",
  "```yaml",
  "schema: numberone/v1",
  "mode: second-match",
  "```",
  "",
  "Prose after the block, with trailing words.",
  "",
].join("\n");

test("parseFencedBlock returns the first yaml block that starts with the marker", () => {
  assert.deepEqual(parseFencedBlock(config, "schema: numberone/v1"), {
    ok: true,
    value: { schema: "numberone/v1", mode: "real", items: ["one", "two"] },
  });
});

test("parseFencedBlock ignores the marker and key: value lines that appear in prose", () => {
  const prose = "Set `schema: numberone/v1` first.\n\nschema: numberone/v1\nmode: from-prose\n";
  assert.deepEqual(parseFencedBlock(prose, "schema: numberone/v1"), {
    ok: false,
    error: 'no ```yaml block starting with "schema: numberone/v1"',
  });
});

test("parseFencedBlock skips leading blank lines inside the fence when matching the marker", () => {
  const flush = "```yaml\n\nschema: numberone/v1\nn: 2\n```\n";
  assert.deepEqual(parseFencedBlock(flush, "schema: numberone/v1"), {
    ok: true,
    value: { schema: "numberone/v1", n: 2 },
  });
});

test("parseFencedBlock accepts a yml tag with extra info-string words", () => {
  const md = "```yml title=x\nschema: numberone/v1\nn: 1\n```\n";
  assert.deepEqual(parseFencedBlock(md, "schema: numberone/v1"), { ok: true, value: { schema: "numberone/v1", n: 1 } });
});

test("parseFencedBlock fails when no block starts with the marker", () => {
  assert.deepEqual(parseFencedBlock(config, "schema: numberone/v2"), {
    ok: false,
    error: 'no ```yaml block starting with "schema: numberone/v2"',
  });
  assert.equal(parseFencedBlock("no fences at all", "schema: numberone/v1").ok, false);
});

test("parseFencedBlock reports malformed YAML inside the matching block", () => {
  const md = "```yaml\nschema: numberone/v1\nbad: [1, 2\nnext: 3\n```\n";
  const result = parseFencedBlock(md, "schema: numberone/v1");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.error.includes("at line 3, column 1"));
});

test("parseFencedBlock handles an unclosed fence by reading to the end of the file", () => {
  const md = "text\n```yaml\nschema: numberone/v1\nn: 1\n";
  assert.deepEqual(parseFencedBlock(md, "schema: numberone/v1"), { ok: true, value: { schema: "numberone/v1", n: 1 } });
});

test("none of the three functions throw on odd input", () => {
  for (const input of ["", "\0", "{{{", "---", "```yaml", "a: *missing"]) {
    assert.doesNotThrow(() => parseYaml(input));
    assert.doesNotThrow(() => parseFrontmatter(input));
    assert.doesNotThrow(() => parseFencedBlock(input, "a: 1"));
  }
});
