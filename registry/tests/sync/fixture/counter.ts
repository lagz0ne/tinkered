import { data, resource, tag } from "@tinker/core";
import { memoryPair, source, subscribe, type Sync } from "../../../src/sync/index.ts";

/** The row gives the cell its wire key; both entries reuse these declarations. */
export const counter = data({ label: "counter", initial: 0 });
export const src = source({ cells: [[counter, "counter"]] });

/** The source root owns the connection promise and gives the guest its half of the wire. */
export const connection = resource({
  label: "counter.connection",
  target: "scope",
  depends: { origin: src },
  factory: ({ origin }, ctx) => {
    const [left, right] = memoryPair();
    const done = origin.connect(left);
    ctx.defer(async () => {
      left.close();
      await done;
    });
    return right;
  },
});

export const wire = tag<Sync.Transport>({ label: "counter.wire" });
const pipe = resource({
  label: "counter.pipe",
  target: "scope",
  depends: { wire },
  factory: ({ wire }, ctx) => {
    ctx.defer(() => wire.close());
    return wire;
  },
});
export const sub = subscribe(pipe, { cells: [[counter, "counter"]] });
