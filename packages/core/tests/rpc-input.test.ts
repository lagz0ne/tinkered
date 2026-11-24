import { memory } from "@tinkered/core/testing";
import { afterEach, expect, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";

import { createScope, isError, operation, rpc } from "@/main";
import type { Data, Errors } from "@/main";

/** A call whose input fails its contract: what its `DataValidationFailed` carries (#55). */

const closers: Array<() => unknown> = [];

afterEach(async () => {
  for (const c of closers.splice(0).reverse()) await c();
});

const api = rpc({
  "note.add": {
    input: z.object({ text: z.string().min(3) }),
    output: z.object({ n: z.number() }),
  },
});

const add = operation({
  label: "note.add.do",
  input: api["note.add"].input,
  run: () => ({ n: 1 }),
});

test("DataValidationFailed's type names both payloads: a data check's and an rpc input's", () => {
  expectTypeOf<Errors.Payload<"DataValidationFailed">>().toEqualTypeOf<
    { label: string; cause: unknown } | { address: string; issues: readonly Data.SchemaIssue[] }
  >();
});

test("an rpc call with bad input fails with its address and issues, not label and cause (#55)", async () => {
  const server = await createScope({
    capsules: [api({ implement: { "note.add": add } }), memory.server({ services: [api] })],
  }).ready;
  closers.push(() => server.close());
  const client = await createScope({
    capsules: [memory.client({ peer: server }), api({ remote: memory.client })],
  }).ready;
  closers.push(() => client.close());

  const result = await client.settle(api["note.add"], { rawInput: { text: "x" } });

  if (result.status !== "failed" || !isError(result.error, "DataValidationFailed")) throw result;
  const { payload } = result.error;
  if (!("address" in payload)) throw payload;
  expect(payload.address).toBe("note.add");
  expect(payload.issues.map((issue) => issue.path)).toEqual([["text"]]);
});
