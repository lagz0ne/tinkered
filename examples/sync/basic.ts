import { createScope, data, resource } from "@tinker/core";
import { memoryPair, source, subscribe } from "@tinker/sync";

/** Sync needs nothing on the cell: its wire key comes from the row, never unit meta (ADR 0051). */
const counter = data({ label: "counter", initial: 0 });

/** One shared declaration, two scopes, one wire: the origin scope installs
 * the source extension with the counter row; the viewer installs the
 * subscribe extension over a resource that hands it its end of the pair; `await guest.ready` holds
 * until the snapshot lands, then the tour reads the viewer cell and
 * detaches. Answers the published key plus the final viewer value. */
export async function tour(): Promise<string> {
  const src = source({ cells: [[counter, "counter"]] });
  const scope = createScope({ extensions: [src] });
  await scope.ready;
  scope.controller(counter).set(1);
  const [left, right] = memoryPair();
  const done = scope.resolve(src).connect(left);
  const pipe = resource({ label: "pipe", factory: () => right });
  const sub = subscribe(pipe, { cells: [[counter, "counter"]] });
  const guest = createScope({ extensions: [sub] });
  try {
    await guest.ready;
  } catch (error) {
    await scope.close();
    throw error;
  }
  const answer = `counter:${guest.resolve(counter)}`;
  guest.resolve(sub).close();
  await done;
  await Promise.all([scope.close({ graceful: true }), guest.close({ graceful: true })]);
  return answer;
}
