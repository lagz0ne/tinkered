import { expect, test } from "vite-plus/test";

import { transport } from "@/main";

// The shapes each layer hands the next: what each one takes, and what it refuses.

const { callInput, hook, openInput, sendInput, traceparentOf, watchInput } = transport;

const ok = (shape: { check: (v: unknown) => { issues?: unknown } }, value: unknown) =>
  shape.check(value).issues === undefined;

const blob = new Blob(["x"], { type: "text/plain" });
const push = () => {};

test("meta keys are lowercase letters, digits and dashes, whole", () => {
  const text = { address: "a", text: "1" };

  expect(ok(sendInput, { ...text, meta: { "x-a1": "v" } })).toBe(true);
  expect(ok(sendInput, { ...text, meta: {} })).toBe(true);
  for (const key of ["X-A", "a b", "-a!", "!a", "a!", ""]) {
    expect(ok(sendInput, { ...text, meta: { [key]: "v" } }), key).toBe(false);
  }
  expect(ok(sendInput, { ...text, meta: { a: 1 } })).toBe(false);
});

test("text in: an address and a text, each a string; bytes only as a body", () => {
  expect(sendInput.check({ address: "a", text: "1", meta: {} })).toEqual({
    value: { address: "a", text: "1", meta: {} },
  });
  expect(ok(sendInput, { address: 1, text: "1", meta: {} })).toBe(false);
  expect(ok(sendInput, { address: "a", text: 1, meta: {} })).toBe(false);
  expect(ok(sendInput, { address: "a", text: "1" })).toBe(false);

  expect(ok(sendInput, { address: "a", text: "1", meta: {}, body: blob })).toBe(true);
  expect(ok(sendInput, { address: "a", text: "1", meta: {}, body: "bytes" })).toBe(false);
  expect(ok(sendInput, { address: "a", text: "1", meta: {}, body: { stream: push } })).toBe(false);
  expect(ok(sendInput, { address: "a", text: "1", meta: {}, body: { type: "t" } })).toBe(false);
});

test("an open takes a push function, and a left that is a signal", () => {
  const base = { address: "a", text: "1", meta: {} };

  expect(ok(openInput, { ...base, push })).toBe(true);
  expect(ok(openInput, { ...base, push, left: new AbortController().signal })).toBe(true);
  expect(ok(openInput, base)).toBe(false);
  expect(ok(openInput, { ...base, push: "no" })).toBe(false);
  expect(ok(openInput, { ...base, push, left: "no" })).toBe(false);
});

test("values in: an address, any value, meta; a watch takes a push too", () => {
  const base = { address: "a", value: { any: 1 }, meta: {} };

  expect(callInput.check(base)).toEqual({ value: base });
  expect(ok(callInput, { ...base, address: 2 })).toBe(false);
  expect(ok(callInput, { ...base, meta: { A: "1" } })).toBe(false);
  expect(ok(watchInput, { ...base, push })).toBe(true);
  expect(ok(watchInput, base)).toBe(false);
  expect(ok(watchInput, { ...base, push: 1 })).toBe(false);
  expect(ok(watchInput, { ...base, push, left: {} })).toBe(false);
});

test("each hook kind takes its own fields, and refuses a value that is not one", () => {
  const base = { key: "k", input: null, meta: {}, context: {} };
  const refuse = () => ({}) as never;

  expect(ok(hook.start, { ...base, refuse })).toBe(true);
  expect(ok(hook.start, base)).toBe(false);
  expect(ok(hook.start, { ...base, refuse: 1 })).toBe(false);
  expect(ok(hook.start, { ...base, key: 1, refuse })).toBe(false);
  expect(ok(hook.success, { ...base, output: 1 })).toBe(true);
  expect(ok(hook.success, { ...base, meta: [] })).toBe(false);
  expect(ok(hook.error, { ...base, error: 1, refuse })).toBe(true);
  expect(ok(hook.error, { ...base, error: 1 })).toBe(false);
  expect(ok(hook.error, { ...base, context: null, refuse })).toBe(false);
  for (const kind of ["output", "refused", "error"]) {
    expect(ok(hook.finish, { ...base, outcome: { kind } }), kind).toBe(true);
  }
  expect(ok(hook.finish, { ...base, outcome: { kind: "other" } })).toBe(false);
  expect(ok(hook.finish, base)).toBe(false);
});

test("traceparent: version 00, lowercase hex, no all-zero id", () => {
  const trace = "0af7651916cd43dd8448eb211c80319c";
  const span = "b7ad6b7169203331";

  expect(traceparentOf(`00-${trace}-${span}-01`)).toEqual({
    traceId: trace,
    parentSpanId: span,
    sampled: true,
  });
  expect(traceparentOf(`00-${trace}-${span}-00`)?.sampled).toBe(false);
  expect(traceparentOf(`00-${trace}-0${"0".repeat(14)}1-01`)?.parentSpanId).toBe(
    `0${"0".repeat(14)}1`,
  );
  for (const bad of [
    `00-${"0".repeat(32)}-${span}-01`,
    `00-${trace}-${"0".repeat(16)}-01`,
    `01-${trace}-${span}-01`,
    `00-${trace.toUpperCase()}-${span}-01`,
    `x00-${trace}-${span}-01`,
    `00-${trace}-${span}-01x`,
    42,
    undefined,
  ]) {
    expect(traceparentOf(bad), String(bad)).toBeNull();
  }
});
