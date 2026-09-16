# React store layer vs Zustand, Jotai, Legend State v2/v3, Preact Signals (2026-09-16)

Bench: `bench/react-stores.mjs` (six libs, real React in happy-dom: N=50 components each subscribed to
one slice; re-render count, update latency, mount) and `bench/stores-probe.mjs` (one lib, one metric per
process — the fair number; grouped mitata carries ordering effects). Vanilla store: `bench/react-vs-zustand.mjs`.

## What was wrong with the old numbers

`bench/react-render.mjs` left the selectivity trees mounted while the update group ran thousands of
writes; the later mount group then read ~2x too high for tinker (1117 vs 490 µs). Isolated, the gap was
1.14x. Heap and mount time are flat over 8000 updates (leak probe). Fixed in 50dd340.

## What landed (three contributor branches, reviewed + re-measured, merged by cherry-pick)

- A `useData` = `useContext` + one `useMemo` + React's `useSyncExternalStore`; the with-selector shim and
  its dependency are gone; the store is keyed on `[scope, cell]` with `selector`/`isEqual` as live
  fields and an identity-tracked slice memo (an inline selector must NOT resubscribe). mount 606→543 µs.
- B `dataController` holds its `NodeState`; `get` reads `rec.eff` directly (chain walk only when
  `effSet` is false or the layer is closed); `addWatcher(layer, rec, last, fn)`; per-layer notify loop.
  read 9.8→2.0 ns, sub_churn 106→90, notifyN −8%.
- C op run path: lazy `defers` owned by the ctx (exposed to the drain via a `static defersOf`, never on
  the instance), borrows skipped via an `operation()`-time symbol flag when deps name no resource,
  `readCall` inlined, synchronous results settle without `track` closures. op 134→79 ns.
- Earlier in the day: watchers indexed per cell (a write visits only that cell's subscribers, value read
  once per layer). notifyN 30→15 µs.

## Standing (per-process min µs; tinker first on both)

| lib            | mount | update |
| -------------- | ----- | ------ |
| tinker         | 535   | 69.5   |
| jotai          | 560   | 79     |
| preact signals | 598   | 82     |
| zustand        | 601   | 84.5   |
| legend v2      | 735   | 96     |
| legend v3 beta | 825   | 108    |

Vanilla store vs Zustand: read 2.0 vs 0.5 ns (structural: scoped cell vs captured object), write+1 sub
69 vs 91, write+1000 subs 15.4 vs 12.5 µs, sub+unsub 90 vs 74. Gate at 808d289: validate lanes PASS,
mutation 78.29%, 210 core + 48 react tests, census OK.

## Review lessons (contributor drafts, one round each)

- A keyed its memo on selector identity → resubscribe every render for inline selectors (numbers hid it).
- B duplicated the hot read body with a "keep in sync" note and wrapped a function in a facade.
- C put a drain accessor on the ctx class as an instance method → leaked onto the user-facing ctx.
  All three fixed cleanly after one review; the pattern is "correct numbers, shape shortcut" — review the
  shape, re-measure yourself.
