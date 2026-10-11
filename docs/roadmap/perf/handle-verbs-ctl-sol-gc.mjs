// GC check for the handle controller memo. Run: node --expose-gc gc-check.mjs <core dist index.mjs>
// Builds a resource, closes its scope through the full close path (an onClose hook), keeps the
// handle, and asks whether the built value was freed. Also checks a session closed by its parent.
import { pathToFileURL } from "node:url";

const { createScope, resource } = await import(pathToFileURL(process.argv[2]).href);

const big = resource({
  label: "big",
  factory: () => ({ payload: Array.from({ length: 200_000 }, () => 1) }),
});

const settle = async () => {
  for (let i = 0; i < 10; i++) {
    globalThis.gc();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

const verdict = (ref) => (ref.deref() === undefined ? "freed" : "ALIVE");

// Case 1: the root's own close.
const root = createScope();
root.controller(big).resolve();
root.controller(big);
const rootRef = new WeakRef(root.controller(big).resolve());
root.onClose(() => {});
const rootResult = await root.close({ graceful: true });
await settle();
console.log(`root close (${rootResult.status}): resource value ${verdict(rootRef)} after close`);

// Case 2: a child without hooks retains the existing fast-close behavior.
const parent = createScope();
const child = parent.createSession();
child.controller(big).resolve();
child.controller(big);
const childRef = new WeakRef(child.controller(big).resolve());
parent.onClose(() => {});
const parentResult = await parent.close({ graceful: true });
await settle();

console.log(
  `parent close without child hook (${parentResult.status}): session resource value ${verdict(childRef)} after close`,
);

// Case 3: a child hook forces full close and must release the memo's built value.
const hookedParent = createScope();
const hookedChild = hookedParent.createSession();
hookedChild.controller(big).resolve();
hookedChild.controller(big);
const hookedRef = new WeakRef(hookedChild.controller(big).resolve());
hookedChild.onClose(() => {});
const hookedResult = await hookedParent.close({ graceful: true });
await settle();

console.log(
  `parent close with child hook (${hookedResult.status}): session resource value ${verdict(hookedRef)} after close`,
);

// Keep the held handles alive until here, so only the close can free their values.
console.log(`handles held: ${typeof root.close} ${typeof child.close} ${typeof hookedChild.close}`);
