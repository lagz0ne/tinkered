import { createScope, type Scope } from "@tinker/core";
import { connection, counter, src, sub, wire } from "./counter.ts";

if (import.meta.main) {
  const stop = new AbortController();
  const requestStop = () => stop.abort();
  process.once("SIGINT", requestStop);
  process.once("SIGTERM", requestStop);
  const origin = createScope({ signal: stop.signal, extensions: [src] });
  let output: string;
  let guestEnd: Scope.Result;
  let originEnd: Scope.Result;
  try {
    await origin.ready;
    origin.controller(counter).set(1);
    const transport = origin.resolve(connection);
    const guest = createScope({
      signal: stop.signal,
      extensions: [sub],
      tags: wire(transport),
    });
    try {
      await guest.ready;
      output = `counter:${guest.resolve(counter)}`;
    } finally {
      stop.abort();
      guestEnd = await guest.closed;
    }
  } finally {
    stop.abort();
    originEnd = await origin.closed;
    process.off("SIGINT", requestStop);
    process.off("SIGTERM", requestStop);
  }
  for (const end of [guestEnd, originEnd]) {
    if (end.status === "failed") throw end.error;
    if (end.teardownErrors?.length) {
      const [error] = end.teardownErrors;
      throw error;
    }
  }
  process.stdout.write(`${output}\n`);
}
