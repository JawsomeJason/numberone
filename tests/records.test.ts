import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatError, validate, type Schema } from "../engine/schema/validate.ts";

const load = (name: string): Schema => JSON.parse(readFileSync(new URL(`../schemas/${name}.v1.json`, import.meta.url), "utf8"));
const errorsOf = (name: string, value: unknown): string[] => {
  const r = validate(load(name), value);
  return r.ok ? [] : r.errors.map(formatError);
};
const valueOf = (name: string, value: unknown): unknown => {
  const r = validate(load(name), value);
  assert.ok(r.ok, JSON.stringify(r));
  return r.value;
};

const event = { v: 1, seq: 0, at: "2026-10-22T16:14:00Z", run: "r-20261022-1614", kind: "run.start", data: {} };
const grant = {
  id: "g-7f3a", schema: "numberone-grant/v1", title: "Grant: post review pings for ticket ABC-50",
  wording: "Until this run reaches its done stage, numberone may post review pings.",
  covers: { runs: ["r-20261022-1614"], prs: ["acme/app#101"], people: [], tickets: ["ABC-50"] },
  actions: [{ verb: "chat.post", where: "channel:review" }],
  expires: { stage: "done" }, status: "pending", asked_at: "2026-10-22T18:10:00Z",
};
const draft = {
  id: "d-1c9e", schema: "numberone-draft/v1",
  to: { kind: "dm", ref: "D000QA", label: "qa-example DM" },
  body: "Both PRs are approved.",
  meta: { why: "speaks for the captain", added: "2026-10-22T18:30:00Z", flow: "pr-to-done", run: "r-20261022-1614", stage: "qa" },
  state: "drafted",
};
const world = {
  t: "2026-10-22T16:00:00Z", source: "forge", kind: "pr.review", actor: "ada-example", bot: false,
  ref: "acme/app#101", summary: "approved", url: "https://example.test/acme/app/pull/101",
};

test("event: a valid event passes and a cost is tokens only", () => {
  assert.deepEqual(errorsOf("event", event), []);
  assert.deepEqual(errorsOf("event", { ...event, kind: "act.done", key: "k1", cost: { layer: "jev", input_tokens: 12, output_tokens: 0 } }), []);
});

test("event: invalid events name the offending path", () => {
  assert.deepEqual(errorsOf("event", { ...event, v: 2 }), ["/v: expected 1"]);
  assert.deepEqual(errorsOf("event", { ...event, seq: 1.5 }), ["/seq: expected integer"]);
  assert.deepEqual(errorsOf("event", { ...event, at: "yesterday" }), ["/at: does not match pattern ^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(\\.\\d+)?Z$"]);
  assert.deepEqual(errorsOf("event", { ...event, kind: "run.pause" }).length, 1);
  assert.match(errorsOf("event", { ...event, kind: "run.pause" })[0], /^\/kind: expected one of "run\.start", /);
  const { data: _data, ...noData } = event;
  assert.deepEqual(errorsOf("event", noData), ["/data: missing required property"]);
  assert.deepEqual(errorsOf("event", { ...event, cost: { layer: "jev", input_tokens: 1, output_tokens: 1, usd: 0.01 } }), ["/cost/usd: unexpected property"]);
  assert.deepEqual(errorsOf("event", { ...event, cost: { layer: "gpu", input_tokens: 1, output_tokens: 1 } }), ['/cost/layer: expected one of "code", "jev", "haiku", "llm"']);
});

test("grant: each of the three expiries passes and a missing expiry defaults to run-end", () => {
  assert.deepEqual(errorsOf("grant", grant), []);
  assert.deepEqual(errorsOf("grant", { ...grant, expires: { "run-end": true } }), []);
  assert.deepEqual(errorsOf("grant", { ...grant, expires: { at: "2026-10-23T00:00:00Z" } }), []);
  const { expires: _expires, ...noExpiry } = grant;
  assert.deepEqual((valueOf("grant", noExpiry) as { expires: unknown }).expires, { "run-end": true });
  assert.equal((valueOf("grant", noExpiry) as { supersedes: unknown }).supersedes, null);
});

test("grant: expiry must be exactly one of run-end, at, stage", () => {
  const two = errorsOf("grant", { ...grant, expires: { stage: "done", at: "2026-10-23T00:00:00Z" } });
  assert.equal(two.length, 1);
  assert.match(two[0], /^\/expires: matches no oneOf branch: /);
  assert.match(errorsOf("grant", { ...grant, expires: {} })[0], /^\/expires: matches no oneOf branch: /);
  assert.match(errorsOf("grant", { ...grant, expires: { when: "tracker.done" } })[0], /^\/expires: matches no oneOf branch: /);
  assert.match(errorsOf("grant", { ...grant, expires: { at: "tomorrow" } })[0], /^\/expires: matches no oneOf branch: /);
});

test("grant: invalid status and missing wording are reported", () => {
  assert.deepEqual(errorsOf("grant", { ...grant, status: "maybe" }), ['/status: expected one of "pending", "approved", "denied", "revoked", "expired"']);
  const { wording: _wording, ...noWording } = grant;
  assert.deepEqual(errorsOf("grant", noWording), ["/wording: missing required property"]);
  assert.deepEqual(errorsOf("grant", { ...grant, actions: [{ where: "channel:review" }] }), ["/actions/0/verb: missing required property"]);
});

test("draft: a valid draft passes and send_box defaults to false", () => {
  assert.deepEqual(errorsOf("draft", draft), []);
  assert.equal((valueOf("draft", draft) as { send_box: unknown }).send_box, false);
  assert.deepEqual(errorsOf("draft", { ...draft, send_box: true, section_id: "temp:C:abc" }), []);
});

test("draft: invalid drafts name the offending path", () => {
  assert.deepEqual(errorsOf("draft", { ...draft, state: "queued" }), ['/state: expected one of "drafted", "sending", "sent", "removed"']);
  assert.deepEqual(errorsOf("draft", { ...draft, to: { ...draft.to, kind: "email" } }), ['/to/kind: expected one of "dm", "channel", "thread"']);
  assert.deepEqual(errorsOf("draft", { ...draft, send_box: "yes" }), ["/send_box: expected boolean"]);
  const { body: _body, ...noBody } = draft;
  assert.deepEqual(errorsOf("draft", noBody), ["/body: missing required property"]);
});

test("world-event: a valid world event passes", () => {
  assert.deepEqual(errorsOf("world-event", world), []);
  assert.deepEqual(errorsOf("world-event", { ...world, bot: true, actor: "ci-bot-example" }), []);
});

test("world-event: invalid world events name the offending path", () => {
  const { url: _url, ...noUrl } = world;
  assert.deepEqual(errorsOf("world-event", noUrl), ["/url: missing required property"]);
  assert.deepEqual(errorsOf("world-event", { ...world, bot: "no" }), ["/bot: expected boolean"]);
  assert.deepEqual(errorsOf("world-event", { ...world, seq: 3 }), ["/seq: unexpected property"]);
  assert.deepEqual(errorsOf("world-event", { ...world, t: 1761148800 }), ["/t: expected string"]);
});
