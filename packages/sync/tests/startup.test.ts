import { expect, test } from "vite-plus/test";
import { createScope, data, resource } from "@tinker/core";
import { createSseClient } from "@tinker/sync/sse";
import { isError, memoryPair, subscribe, type Sync } from "../src/index.ts";

const counter = data({ label: "counter", initial: 0 });
const other = data({ label: "other", initial: 0 });
const closedWirings: { cells: Sync.Row[]; missing: string[] }[] = [
  { cells: [[counter, "counter"]], missing: ["counter"] },
  { cells: [], missing: [] },
];

test("a transport already closed before setup rejects ready after cleanup", async () => {
  for (const { cells, missing } of closedWirings) {
    const wire = createSseClient({ open: () => expect.unreachable() });
    wire.close();
    let cleaned = false;
    const link = resource({
      label: "closed wire",
      factory: (_deps, ctx) => {
        ctx.defer(() => {
          cleaned = true;
        });
        return wire;
      },
    });
    const guest = createScope({ extensions: [subscribe(link, { cells })] });
    try {
      await guest.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "SyncNotReady")) throw error;
      expect(error.payload.missing).toEqual(missing);
      expect(cleaned).toBe(true);
    }
  }
});

test("a conflicting subscription closes its opened wire before ready rejects", async () => {
  const [near, far] = memoryPair();
  const events: string[] = [];
  near.onClose(() => events.push("closed"));
  const link = resource({ label: "opened wire", factory: () => far });
  const guest = createScope({
    extensions: [
      subscribe(link, {
        cells: [
          [counter, "counter"],
          [other, "counter"],
        ],
      }),
    ],
  });
  try {
    await guest.ready;
    expect.unreachable();
  } catch (error) {
    if (!isError(error, "SyncConflict")) throw error;
    events.push("rejected");
  } finally {
    far.close();
  }
  expect(events).toEqual(["closed", "rejected"]);
});
