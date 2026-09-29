import { expect, test } from "vite-plus/test";
import { createScope, operation, tag, type Operation } from "../src/index.ts";

/** Every body gets the real `ctx` as its second argument, however it declares its parameters:
 * `Function.length` does not count rest or defaulted parameters and says nothing about
 * `arguments`, so a parameter count proves nothing about what a body reads. A sync body on an
 * idle session comes back as a value, tagged or not (ADR 0072). */
const zone = tag<string>({ label: "zone", default: "base" });
const wrap =
  <A extends unknown[], R>(fn: (...args: A) => R) =>
  (...args: A): R =>
    fn(...args);
const fake = { label: "fake" } as unknown as Operation.Ctx<void>;

for (const tagged of [false, true]) {
  const label = tagged ? "tagged" : "untagged";
  const run = <T>(op: Operation.Handle<T, void>): T | Promise<Awaited<T>> =>
    tagged ? createScope().run(op, { tags: [zone("x")] }) : createScope().run(op);

  test(`a body behind a rest-parameter wrapper reads ctx (${label})`, () => {
    const op = operation({
      label: "wrapped",
      run: wrap((_deps: unknown, ctx: Operation.Ctx<void>) => ctx.label),
    });
    expect(run(op)).toBe("wrapped");
  });

  test(`a body with a defaulted ctx parameter reads the real ctx (${label})`, () => {
    /** Declared apart from the call, so the default stands on the body's own signature. */
    const body = (_deps: unknown, ctx: Operation.Ctx<void> | undefined = fake): string =>
      `${ctx.label}:${typeof ctx.defer}`;
    const op = operation({ label: "defaulted", run: body });
    expect(run(op)).toBe("defaulted:function");
  });

  test(`a body reading its second argument through \`arguments\` gets ctx (${label})`, () => {
    const op = operation({
      label: "arguments",
      run: function (this: void) {
        return (arguments as unknown as [unknown, Operation.Ctx<void>])[1].label;
      },
    });
    expect(run(op)).toBe("arguments");
  });
}
