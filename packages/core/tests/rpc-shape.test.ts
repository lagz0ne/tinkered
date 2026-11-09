import { expect, test } from "vite-plus/test";

import { transport } from "@/main";
import * as z from "@/rpc-shape";

const { request, requestStop, traceparentOf } = transport;

const message = (got: { issues?: readonly { message: string }[] }) => got.issues?.[0]?.message;

test("a shape is a Standard Schema: validate and check give the same result", () => {
  const s = z.string();

  expect(s["~standard"]).toMatchObject({ version: 1, vendor: "tinker" });
  expect(s["~standard"].validate("a")).toEqual({ value: "a" });
  expect(s.check(1)).toEqual({ issues: [{ message: "expected a string" }] });
});

test("a string shape narrows to a pattern with regex", () => {
  const s = z.string().regex(/^[a-z]+$/);

  expect(s.check("abc")).toEqual({ value: "abc" });
  expect(message(s.check("ABC"))).toBe("expected /^[a-z]+$/");
  expect(message(s.check(3))).toBe("expected a string");
  expect(z.string().check("ABC")).toEqual({ value: "ABC" });
});

test("unknown takes any value; null takes only null", () => {
  expect(z.unknown().check(undefined)).toEqual({ value: undefined });
  expect(z.null().check(null)).toEqual({ value: null });
  expect(message(z.null().check(undefined))).toBe("expected null");
  expect(message(z.null().check(0))).toBe("expected null");
});

test("custom keeps the value the predicate admits, with its own message or the default", () => {
  const even = z.custom<number>((v) => typeof v === "number" && v % 2 === 0, "expected even");
  const odd = z.custom<number>((v) => typeof v === "number" && v % 2 === 1);

  expect(even.check(4)).toEqual({ value: 4 });
  expect(message(even.check(3))).toBe("expected even");
  expect(message(odd.check(2))).toBe("unexpected value");
});

test("optional admits undefined and still checks every other value", () => {
  const s = z.string().optional();

  expect(s.isOptional).toBe(true);
  expect(s.check(undefined)).toEqual({ value: undefined });
  expect(s.check("a")).toEqual({ value: "a" });
  expect(message(s.check(1))).toBe("expected a string");
});

test("record checks each key and each value, and refuses non-objects", () => {
  const s = z.record(z.string().regex(/^[a-z]+$/), z.string());

  expect(s.check({ a: "1", b: "2" })).toEqual({ value: { a: "1", b: "2" } });
  expect(message(s.check({ A: "1" }))).toBe('bad key "A"');
  expect(message(s.check({ a: 1 }))).toBe("expected a string");
  for (const bad of [null, [], "x", 1]) expect(message(s.check(bad))).toBe("expected an object");
});

test("array checks each item and refuses non-arrays", () => {
  const s = z.array(z.string());

  expect(s.check(["a", "b"])).toEqual({ value: ["a", "b"] });
  expect(s.check([])).toEqual({ value: [] });
  expect(message(s.check(["a", 1]))).toBe("expected a string");
  expect(message(s.check({ length: 0 }))).toBe("expected an array");
});

test("object checks its fields, names the bad field in the path, and drops unknown keys", () => {
  const s = z.object({ name: z.string(), note: z.string().optional() });

  expect(s.check({ name: "a", extra: 1 })).toEqual({ value: { name: "a" } });
  expect(s.check({ name: "a", note: "b" })).toEqual({ value: { name: "a", note: "b" } });
  expect(s.check({ name: 1 })).toEqual({
    issues: [{ message: "expected a string", path: ["name"] }],
  });
  expect(message(s.check(null))).toBe("expected an object");
  expect(message(s.check("x"))).toBe("expected an object");
});

test("object keeps a key sent as undefined, and leaves out a key not sent", () => {
  const s = z.object({ note: z.string().optional() });

  const sent = s.check({ note: undefined });
  expect(Object(sent).value).toHaveProperty("note", undefined);
  expect(Object(s.check({})).value).not.toHaveProperty("note");
});

test("a nested issue keeps its inner path under the outer field", () => {
  const s = z.object({ outer: z.object({ inner: z.string() }) });

  expect(s.check({ outer: { inner: 1 } }).issues?.[0]?.path).toEqual(["outer", "inner"]);
});

test("extend adds fields and a later field replaces an earlier one", () => {
  const base = z.object({ a: z.string(), b: z.string() });
  const more = base.extend({ b: z.unknown(), c: z.null() });

  expect(Object.keys(more.shape)).toEqual(["a", "b", "c"]);
  expect(more.check({ a: "x", b: 1, c: null })).toEqual({ value: { a: "x", b: 1, c: null } });
  expect(message(more.check({ a: "x", b: 1, c: 0 }))).toBe("expected null");
  expect(base.check({ a: "x", b: 1 }).issues).toBeDefined();
});

test("checkWith reads a foreign schema, and refuses one that answers with a promise", () => {
  const foreign = {
    "~standard": { version: 1 as const, vendor: "x", validate: (v: unknown) => ({ value: v }) },
  };
  const slow = {
    "~standard": {
      version: 1 as const,
      vendor: "x",
      validate: async (v: unknown) => ({ value: v }),
    },
  };
  const bad = {
    "~standard": {
      version: 1 as const,
      vendor: "x",
      validate: () => ({ issues: [{ message: "no" }] }),
    },
  };

  expect(z.checkWith(foreign, 1)).toEqual({ value: 1 });
  expect(message(z.checkWith(slow, 1))).toBe("an async schema cannot check a protocol value");
  expect(z.checkWith(bad, 1)).toEqual({ issues: [{ message: "no" }] });
});

test("the request tags carry their labels", () => {
  expect(request.label).toBe("request");
  expect(requestStop.label).toBe("request.stop");
});

test("traceparentOf reads a W3C version 00 header, with the sampled flag", () => {
  const trace = "0af7651916cd43dd8448eb211c80319c";
  const span = "b7ad6b7169203331";

  expect(traceparentOf(`00-${trace}-${span}-01`)).toEqual({
    traceId: trace,
    parentSpanId: span,
    sampled: true,
  });
  expect(traceparentOf(`00-${trace}-${span}-00`)?.sampled).toBe(false);
  expect(traceparentOf(`00-${trace}-${span}-03`)?.sampled).toBe(true);
  expect(traceparentOf(`00-${trace}-${span}-02`)?.sampled).toBe(false);
});

test("traceparentOf gives null for a missing or bad header", () => {
  const trace = "0af7651916cd43dd8448eb211c80319c";
  const span = "b7ad6b7169203331";

  for (const bad of [
    undefined,
    7,
    "",
    `01-${trace}-${span}-01`,
    `00-${"0".repeat(32)}-${span}-01`,
    `00-${trace}-${"0".repeat(16)}-01`,
    `00-${trace.toUpperCase()}-${span}-01`,
    `00-${trace}-${span}-01-extra`,
    `x00-${trace}-${span}-01`,
  ]) {
    expect(traceparentOf(bad)).toBeNull();
  }
});
