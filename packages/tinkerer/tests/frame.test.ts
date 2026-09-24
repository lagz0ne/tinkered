import { expect, test } from "vite-plus/test";
import { createScope, isError } from "@tinker/core";
import { cwd, tinkerer } from "../src/index.ts";

test("a frame names each tag and cell after its label", () => {
  const coder = tinkerer({ label: "coder" });
  expect(coder.label).toBe("coder");
  expect(coder.config.label).toBe("coder.config");
  expect(coder.mode.label).toBe("coder.mode");
  expect(coder.messages.label).toBe("coder.messages");
  expect(coder.status.label).toBe("coder.status");
  expect(coder.text.label).toBe("coder.text");
  expect(coder.usage.label).toBe("coder.usage");
  expect(coder.settings.label).toBe("coder.settings");
  expect(coder.inbox.label).toBe("coder.inbox");
  expect(tinkerer().messages.label).toBe("tinkerer.messages");
});

test("a fresh frame's cells start at their listed values", async () => {
  const coder = tinkerer();
  const scope = createScope();
  const session = scope.createSession();
  expect(session.resolve(coder.messages)).toEqual([]);
  expect(session.resolve(coder.status)).toBe("idle");
  expect(session.resolve(coder.text)).toBe("");
  expect(session.resolve(coder.usage)).toStrictEqual({ input: 0, cached: 0, output: 0 });
  expect(session.resolve(coder.inbox)).toEqual([]);
  expect(session.resolve(coder.settings)).toBeUndefined();
  await scope.close();
});

test("an unbound config tag fails with MissingTag naming the tag", async () => {
  const coder = tinkerer({ label: "coder" });
  const scope = createScope();
  try {
    scope.resolve(coder.config.required);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload).toEqual({ label: "coder.config" });
  }
  await scope.close();
});

test("an unbound mode tag fails with MissingTag naming the tag", async () => {
  const coder = tinkerer({ label: "coder" });
  const scope = createScope();
  try {
    scope.resolve(coder.mode.required);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload).toEqual({ label: "coder.mode" });
  }
  await scope.close();
});

test("an unbound cwd tag fails with MissingTag naming the tag", async () => {
  const scope = createScope();
  try {
    scope.resolve(cwd.required);
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "MissingTag")) throw error;
    expect(error.payload).toEqual({ label: "tinkerer.cwd" });
  }
  await scope.close();
});
