import { createScope, data } from "@tinker/core";
import { memoryPair, source, subscribe, sync, synced } from "@tinker/sync";

/** The shared counter: one synced cell. */
const counter = data({ label: "counter", initial: 0, meta: [synced({ key: "counter" })] });

/** One shared declaration, two scopes, one wire: the origin scope binds
 * the counter and installs the source extension; the viewer binds the
 * counter and installs the subscribe extension on its end of the pair;
 * `await guest.ready` holds until the snapshot lands, then the tour reads
 * the viewer cell and detaches. Answers the bound labels plus the final
 * viewer value. */
export function tour(): Promise<string> {
  const src = source();
  const scope = createScope({ tags: [sync(counter)], extensions: [src] });
  scope.controller(counter).set(1);
  const bound = scope.resolve(sync.all);
  const names = bound.map((unit) => unit.label).join(",");
  const [left, right] = memoryPair();
  const done = scope.resolve(src).connect(left);
  const sub = subscribe(right);
  const guest = createScope({ tags: [sync(counter)], extensions: [sub] });
  return guest.ready.then(() => {
    const answer = `${names}:${guest.resolve(counter)}`;
    guest.resolve(sub).close();
    return done.then(() =>
      Promise.all([scope.close({ graceful: true }), guest.close({ graceful: true })]).then(
        () => answer,
      ),
    );
  });
}
