import { expect, test } from "vite-plus/test";

import { createScope, data, namespace } from "@/main";

type Row = { id: number } | null;

/** What a row cell's eq throws when its first value is null. */
const eqError = new Error("eq read a null row");

/** A cell whose eq guards only its second value, as in the path test: `eq(null, ...)` throws. */
function rowCell(label: string) {
  return data<Row>({
    label,
    initial: { id: 1 },
    eq: (x, y) => {
      if (x === null) throw eqError;
      return x.id === y?.id;
    },
  });
}

/** A cell in its own scope whose watcher records each value it hears. */
function heardCell(): { set: (next: number) => void; heard: number[] } {
  const b = data({ label: "round.heard", initial: 0 });
  const control = createScope().controller(b);
  const heard: number[] = [];
  control.watch((next) => heard.push(next));
  return { set: (next) => control.set(next), heard };
}

/** The error a call throws, or undefined. */
function thrownBy(call: () => void): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

test("bug 5: an eq that throws in a namespaced write's round leaves later writes heard", () => {
  const a = rowCell("round.ns");
  const first = namespace();
  const second = namespace();
  const scope = createScope();
  scope.controller(a, { ns: [first, second] }).watch(() => {});
  scope.controller(a, { ns: first }).set(null);
  const b = heardCell();

  const error = thrownBy(() => scope.controller(a, { ns: second }).set({ id: 2 }));
  b.set(1);

  expect(error).toBe(eqError);
  expect(b.heard).toEqual([1]);
});

test("an eq throw in a waiting round goes to the first write; later writes are heard", () => {
  const a = rowCell("round.waiting");
  const ns = namespace();
  const scope = createScope();
  scope.controller(a, { ns }).watch(() => {});
  scope.controller(a, { ns }).set(null);
  const trigger = data({ label: "round.trigger", initial: 0 });
  scope.controller(trigger).watch(() => scope.controller(a).set({ id: 2 }));
  const b = heardCell();

  const error = thrownBy(() => scope.controller(trigger).set(1));
  b.set(1);

  expect(error).toBe(eqError);
  expect(b.heard).toEqual([1]);
});

test("an eq throw in a watcher's write goes to the first write; later writes are heard", () => {
  const a = rowCell("round.before");
  const scope = createScope();
  scope.controller(a).set(null);
  const trigger = data({ label: "round.trigger", initial: 0 });
  scope.controller(trigger).watch(() => scope.controller(a).set({ id: 2 }));
  const b = heardCell();

  const error = thrownBy(() => scope.controller(trigger).set(1));
  b.set(1);

  expect(error).toBe(eqError);
  expect(b.heard).toEqual([1]);
});

test("a watcher that catches a write's eq throw keeps its round and the order", () => {
  const a = rowCell("round.caught");
  const scope = createScope();
  scope.controller(a).set(null);
  const c = data({ label: "round.c", initial: 0 });
  const t = data({ label: "round.t", initial: 0 });
  const log: string[] = [];
  scope.controller(c).watch(() => log.push("c heard 1"));
  scope.controller(t).watch(() => {
    if (thrownBy(() => scope.controller(a).set({ id: 2 })) === eqError) log.push("w1 caught");
    scope.controller(c).set(1);
    log.push("w1 wrote c");
  });
  scope.controller(t).watch(() => log.push("w2 heard t"));

  scope.controller(t).set(1);

  expect(log).toEqual(["w1 caught", "w1 wrote c", "w2 heard t", "c heard 1"]);
});
