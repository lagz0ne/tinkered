// Warm-read timing lane (ADR 0016): a warm read must be O(1) in chain depth — the effective-cell
// cache must not re-walk ancestors. Moved out of core's default test run (tests/busy-host-flake):
// a wall-clock ratio fails by luck on a busy box. Run it through the queue, never by hand:
//   benchctl exec -- node --experimental-strip-types bench/warm-read.mjs
// Same promise as the old test: deep < shallow * 5 + 100 ns per read (was + 10 ms per 100k reads).
// A re-walk of 200 layers costs 200 map lookups per read, far past that limit.
const { createScope, data } = await import("../packages/core/src/index.ts");

const ITERS = 100_000;
const ROUNDS = 15;
const DEEP = 200;
const RATIO = 5;
const SLACK_NS = 100;

const asNumber = (v) => {
  if (typeof v !== "number") throw new Error("not a number");
  return v;
};

/** A warm leaf controller `depth` sessions below the root; `seedRoot` writes the root's cell. */
const warmLeaf = (depth, seedRoot) => {
  const v = data({ initial: 0, parse: asNumber });
  const root = createScope();
  let layer = root;
  for (let i = 0; i < depth; i++) layer = layer.createSession();
  if (seedRoot) root.controller(v).set(1);
  const leaf = layer.controller(v);
  leaf.get();
  return leaf;
};

const nsPerRead = (leaf) => {
  const start = performance.now();
  for (let i = 0; i < ITERS; i++) leaf.get();
  return ((performance.now() - start) * 1e6) / ITERS;
};

/** Min ns per read over ROUNDS, shallow and deep interleaved so both see the same drift. */
const compare = (seedRoot) => {
  const shallow = warmLeaf(1, seedRoot);
  const deep = warmLeaf(DEEP, seedRoot);
  let best = { shallow: Infinity, deep: Infinity };
  for (let r = 0; r < ROUNDS; r++) {
    best = {
      shallow: Math.min(best.shallow, nsPerRead(shallow)),
      deep: Math.min(best.deep, nsPerRead(deep)),
    };
  }
  return best;
};

let fail = false;
for (const [label, seedRoot] of [
  ["cached inherited entry", true],
  ["cached absence (initial)", false],
]) {
  const { shallow, deep } = compare(seedRoot);
  const limit = shallow * RATIO + SLACK_NS;
  const ok = deep < limit;
  if (!ok) fail = true;
  console.log(
    `${ok ? "OK  " : "FAIL"} warm read, ${label}: depth 1 ${shallow.toFixed(1)} ns, ` +
      `depth ${DEEP} ${deep.toFixed(1)} ns (limit ${limit.toFixed(1)} ns)`,
  );
}
process.exit(fail ? 1 : 0);
