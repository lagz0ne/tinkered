import { memory } from "@tinkered/core/testing";
import { afterEach, expect, test } from "vite-plus/test";
import { z } from "zod";

import { bytes, createScope, operation, rpc } from "@/main";
import type { RpcBody } from "@/main";

// A bytes field: the contract library's own field, marked by `bytes` with its limits.

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const file = () => bytes(z.custom<RpcBody>(), { max: 64, types: ["text/plain", "image/png"] });

const api = rpc({
  put: {
    input: z.object({ name: z.string(), file: file() }),
    output: z.object({ name: z.string(), type: z.string(), text: z.string() }),
  },
  plain: { input: z.null(), output: z.null() },
});

const put = operation({
  label: "put.here",
  input: api.put.input,
  run: async (_, { input }) => ({
    name: input.name,
    type: input.file.type,
    text: await input.file.text(),
  }),
});

const plain = operation({ label: "plain.here", input: z.null(), run: () => null });

async function pair() {
  const server = await createScope({
    capsules: [api({ implement: { put, plain } }), memory.server({ services: [api] })],
  }).ready;
  closers.push(() => server.close());
  const tab = await createScope({
    capsules: [memory.client({ peer: server }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => tab.close());

  return { server, tab };
}

test("a bytes field crosses as bytes, with a type the key takes", async () => {
  const { tab } = await pair();

  // Bun's Blob adds `;charset=utf-8` to a `text/plain` type; Node's keeps it as given.
  const plainText = expect.stringMatching(/^text\/plain(;charset=utf-8)?$/);

  const text = new Blob(["hi"], { type: "text/plain;charset=utf-8" });
  expect(await tab.run(api.put, { input: { name: "a", file: text } })).toEqual({
    name: "a",
    type: plainText,
    text: "hi",
  });

  const other = new Blob(["x"], { type: "text/html" });
  expect(await tab.run(api.put, { input: { name: "b", file: other } })).toMatchObject({
    type: plainText,
  });
});

test("a value that is not bytes fails on the client, before it is sent", async () => {
  const { tab } = await pair();

  const failed = await tab.settle(api.put, { input: { name: "a", file: "no" as never } });
  expect(Object(failed).error).toMatchObject({
    kind: "DataValidationFailed",
    payload: { address: "put", issues: [{ message: "expected bytes", path: ["file"] }] },
  });
});

test("the server refuses a bytes key with no bytes as invalid", async () => {
  const { server } = await pair();

  const text = await server.run(memory.server.serve, {
    input: { address: "put", text: '{"name":"a"}', meta: {} },
  });
  expect(JSON.parse(text!)).toEqual({ ok: false, kind: "invalid", payload: {} });
});

test("the definition lists each bytes key's limits for the transport", () => {
  expect(api.uploads).toEqual({ put: { max: 64, types: ["text/plain", "image/png"] } });
});

test("bytes takes a positive whole max and one type at least", () => {
  expect(() => bytes(z.custom<RpcBody>(), { max: 0 })).toThrow("bytes: max");
  expect(() => bytes(z.custom<RpcBody>(), { max: 1.5 })).toThrow("bytes: max");
  expect(() => bytes(z.custom<RpcBody>(), { max: 1, types: [] })).toThrow("bytes: max");
  expect(
    rpc({ k: { input: z.object({ f: bytes(z.custom(), { max: 1 }) }), output: z.null() } }).uploads,
  ).toEqual({ k: { max: 1, types: ["application/octet-stream"] } });
});

test("a key takes one bytes field at most, and only as a reply key", () => {
  const two = { input: z.object({ a: file(), b: file() }), output: z.null() };
  const stream = { input: z.object({ a: file() }), output: z.null(), mode: "stream" as const };

  expect(() => rpc({ two })).toThrow('"two" takes bytes in one field at most');
  expect(() => rpc({ watch: stream })).toThrow('"watch" takes bytes in one field at most');
});
