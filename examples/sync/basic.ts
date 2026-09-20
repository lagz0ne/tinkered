import { createScope, data } from "@tinker/core";
import { memoryPair, source, subscribe } from "@tinker/sync";

/** The shared counter: one plain cell, named by the row. */
const counter = data({ label: "counter", initial: 0 });

/** One shared declaration, two scopes, one wire: the origin scope installs
 * the source extension with the counter row; the viewer installs the
 * subscribe extension on its end of the pair; `await guest.ready` holds
 * until the snapshot lands, then the tour reads the viewer cell and
 * detaches. Answers the published key plus the final viewer value. */
export function tour(): Promise<string> {
  const src = source({ cells: [[counter, "counter"]] });
  const scope = createScope({ extensions: [src] });
  scope.controller(counter).set(1);
  const [left, right] = memoryPair();
  const done = scope.resolve(src).connect(left);
  const sub = subscribe(right, { cells: [[counter, "counter"]] });
  const guest = createScope({ extensions: [sub] });
  return guest.ready.then(() => {
    const answer = `counter:${guest.resolve(counter)}`;
    guest.resolve(sub).close();
    return done.then(() =>
      Promise.all([scope.close({ graceful: true }), guest.close({ graceful: true })]).then(
        () => answer,
      ),
    );
  });
}
