import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { createScope, data, resource } from "@tinkered/core";
import { ScopeProvider, useData } from "@tinkered/react";
import { useAtomValueRaw } from "jotai/react";
import { atom, createStore } from "jotai/vanilla";
import { observable as observable2 } from "legend2";
import { observer as observer2 } from "legend2/react";
import { observable as observable3 } from "legend3";
import { observer as observer3, use$ } from "legend3/react";
import { createContext, createElement as h, useContext, useState } from "react";
import type { ReactNode } from "react";
import { create } from "zustand";

// The measured code: N components, each subscribed to ONE slice, in each library's own idiom.
// Every block was audited against its installed source for its best setup (the playground's
// bench/runners.ts carries the long audit notes; the setups here are the same). The useState
// rows use React state on purpose: they are the subjects, not the site's own state.

/** Components per tree. */
export const N = 50;

export type Lib = {
  name: string;
  /** Fine-grained (the ideal), or a naive baseline kept for contrast. */
  fine: boolean;
  /** The no-store floor: shown in the table, left out of the takeaway. */
  control?: boolean;
  /** Set when fan-out is not the library's own state (the control borrows a Context). */
  fanoutNote?: string;
  App: () => ReactNode;
  update: (i: number, v: number) => void;
  /** Writes the ONE shared slice every component also reads, so all N re-render. */
  updateShared: (v: number) => void;
  renders: () => number;
  reset: () => void;
};

/** Read by every component, so no read is dead code. */
type Sink = { value: unknown };

const indexes = [...Array(N).keys()];

/** @tinkered/react: one cell per slice, one shared cell, one scope. */
const tinker = resource({
  label: "bench.tinker",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    const cells = indexes.map((i) => data({ label: `c${i}`, initial: 0 }));
    const shared = data({ label: "shared", initial: 0 });
    const scope = createScope();
    const controllers = cells.map((c) => scope.controller(c));
    const sharedController = scope.controller(shared);

    const Cell = ({ i }: { i: number }) => {
      sink.value = useData(cells[i]!);
      sink.value = useData(shared);
      renders++;
      return null;
    };
    const children = indexes.map((i) => h(Cell, { key: i, i }));

    return {
      name: "@tinkered/react",
      fine: true,
      App: () => h("div", null, h(ScopeProvider, { scope, children })),
      update: (i, v) => controllers[i]!.set(v),
      updateShared: (v) => sharedController.set(v),
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** Zustand: selectors outside the component, the plain partial merge. */
const zustand = resource({
  label: "bench.zustand",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    const keys = indexes.map((i) => `k${i}`);
    const useZ = create<Record<string, number>>(() => ({
      ...Object.fromEntries(keys.map((k) => [k, 0])),
      shared: 0,
    }));
    const selectors = keys.map((k) => (s: Record<string, number>) => s[k]);

    const Cell = ({ i }: { i: number }) => {
      sink.value = useZ(selectors[i]!);
      sink.value = useZ((s) => s.shared);
      renders++;
      return null;
    };
    const children = indexes.map((i) => h(Cell, { key: i, i }));

    return {
      name: "Zustand",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => useZ.setState({ [keys[i]!]: v }),
      updateShared: (v) => useZ.setState({ shared: v }),
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** Jotai: an atom per slice, its own store, hoisted options. */
const jotai = resource({
  label: "bench.jotai",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    const atoms = indexes.map(() => atom(0));
    const sharedAtom = atom(0);
    const store = createStore();
    const opts = { store };

    const Cell = ({ i }: { i: number }) => {
      sink.value = useAtomValueRaw(atoms[i]!, opts);
      sink.value = useAtomValueRaw(sharedAtom, opts);
      renders++;
      return null;
    };
    const children = indexes.map((i) => h(Cell, { key: i, i }));

    return {
      name: "Jotai",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => store.set(atoms[i]!, v),
      updateShared: (v) => store.set(sharedAtom, v),
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** Legend v2: one root primitive observable per slice, `observer`. */
const legend2 = resource({
  label: "bench.legend2",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    const slices = indexes.map(() => observable2(0));
    const shared = observable2(0);

    const Cell = observer2(({ i }: { i: number }) => {
      sink.value = slices[i]!.get();
      sink.value = shared.get();
      renders++;
      return null;
    });
    const children = indexes.map((i) => h(Cell, { key: i, i }));

    return {
      name: "Legend v2",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => slices[i]!.set(v),
      updateShared: (v) => shared.set(v),
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** Legend v3: the same shape, `observer` + `use$`. */
const legend3 = resource({
  label: "bench.legend3",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    const slices = indexes.map(() => observable3(0));
    const shared = observable3(0);

    const Cell = observer3(({ i }: { i: number }) => {
      sink.value = use$(slices[i]!);
      sink.value = use$(shared);
      renders++;
      return null;
    });
    const children = indexes.map((i) => h(Cell, { key: i, i }));

    return {
      name: "Legend v3",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => slices[i]!.set(v),
      updateShared: (v) => shared.set(v),
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** Preact signals: the managed form, what the Babel transform emits. */
const preact = resource({
  label: "bench.preact",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    const sigs = indexes.map(() => signal(0));
    const shared = signal(0);

    const Cell = ({ i }: { i: number }) => {
      const tracked = useSignals(1);
      try {
        sink.value = sigs[i]!.value;
        sink.value = shared.value;
        renders++;
        return null;
      } finally {
        tracked.f();
      }
    };
    const children = indexes.map((i) => h(Cell, { key: i, i }));

    return {
      name: "Preact Signals",
      fine: true,
      App: () => h("div", null, children),
      update: (i, v) => void (sigs[i]!.value = v),
      updateShared: (v) => void (shared.value = v),
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** The control: useState per component, the floor for one sync re-render. Fan-out goes through
 * a plain Context, the honest no-store way; the row says so. Setters come from the last mount. */
const control = resource({
  label: "bench.control",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    const setters: Array<(v: number) => void> = [];
    let setShared: ((v: number) => void) | undefined;
    const SharedCtx = createContext(0);

    const Cell = ({ i }: { i: number }) => {
      const [v, set] = useState(0);
      setters[i] = set;

      sink.value = v;
      sink.value = useContext(SharedCtx);
      renders++;
      return null;
    };
    const children = indexes.map((i) => h(Cell, { key: i, i }));
    const Provider = () => {
      const [value, set] = useState(0);
      setShared = set;
      return h(SharedCtx.Provider, { value }, children);
    };

    return {
      name: "React useState (control)",
      fine: true,
      control: true,
      fanoutNote: "Context",
      App: () => h("div", null, h(Provider)),
      update: (i, v) => setters[i]!(v),
      updateShared: (v) => setShared?.(v),
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** The naive baseline: one Context value, so every consumer re-renders on any change. */
const context = resource({
  label: "bench.context",
  factory: (): Lib => {
    const sink: Sink = { value: undefined };
    let renders = 0;
    let current = indexes.map(() => 0);
    let setArray: ((next: number[]) => void) | undefined;
    const Ctx = createContext<readonly number[]>([]);

    const Cell = ({ i }: { i: number }) => {
      sink.value = useContext(Ctx)[i];
      renders++;
      return null;
    };
    const children = indexes.map((i) => h(Cell, { key: i, i }));
    const Store = () => {
      const [value, set] = useState(current);
      setArray = set;
      return h(Ctx.Provider, { value }, children);
    };

    return {
      name: "React Context",
      fine: false,
      App: () => h("div", null, h(Store)),
      update: (i, v) => {
        current = current.with(i, v);
        setArray?.(current);
      },
      updateShared: (v) => {
        current = current.with(0, v);
        setArray?.(current);
      },
      renders: () => renders,
      reset: () => void (renders = 0),
    };
  },
});

/** Every library, in the order the page shows them. */
export const subjects = resource({
  label: "bench.subjects",
  depends: { tinker, zustand, jotai, legend2, legend3, preact, control, context },
  factory: (libs): Lib[] => Object.values(libs),
});
