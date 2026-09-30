import { createScope, resource, tag, type Scope } from "@tinker/core";
import { memoryPair, subscribe, type Sync } from "@tinker/sync";
import { counter, src } from "./counter.ts";

/** The source root owns the connection promise and gives the guest its half of the wire. */
const connection = resource({
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

const wire = tag<Sync.Transport>({ label: "counter.wire" });
const pipe = resource({
  label: "counter.pipe",
  target: "scope",
  depends: { wire },
  factory: ({ wire }, ctx) => {
    ctx.defer(() => wire.close());
    return wire;
  },
});
const sub = subscribe(pipe, { cells: [[counter, "counter"]] });

/** A new pair of roots reuses one graph; guest readiness waits for the source snapshot. */
export async function tour(value = 1): Promise<string> {
  const originStop = new AbortController();
  const origin = createScope({ signal: originStop.signal, extensions: [src] });
  let output: string;
  let guestEnd: Scope.Result;
  let originEnd: Scope.Result;
  try {
    await origin.ready;
    origin.controller(counter).set(value);
    const transport = origin.resolve(connection);
    const guestStop = new AbortController();
    const guest = createScope({
      signal: guestStop.signal,
      extensions: [sub],
      tags: wire(transport),
    });
    try {
      await guest.ready;
      output = `counter:${guest.resolve(counter)}`;
    } finally {
      guestStop.abort();
      originStop.abort();
      guestEnd = await guest.closed;
    }
  } finally {
    originStop.abort();
    originEnd = await origin.closed;
  }
  for (const end of [guestEnd, originEnd]) {
    if (end.status === "failed") throw end.error;
    if (end.teardownErrors?.length) {
      const [error] = end.teardownErrors;
      throw error;
    }
  }
  return output;
}

if (import.meta.main) process.stdout.write(`${await tour()}\n`);
