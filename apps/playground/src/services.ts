import { resource } from "@tinker/core";
import { compile } from "@/compiler.ts";
import { isError } from "@/errors.ts";
import {
  activeCell,
  bundleCell,
  debounce,
  dirtyCell,
  filesCell,
  statusCell,
  storage,
  themeCell,
} from "@/state.ts";

// Every effect the shell has is a resource: built once per scope, its deps declared, its cleanup a
// `defer` the scope runs on close. Resolving one starts it; nothing is stopped by hand. React
// never holds an effect of its own.

/** Hydrates the cells from `storage` on build, then mirrors every later change back to it. A
 * stored session is restored only if the user had edited it; otherwise the current default example
 * wins and only the theme carries over. */
export const persistence = resource({
  label: "persistence",
  depends: {
    storage: storage.required,
    files: filesCell.controller,
    active: activeCell.controller,
    theme: themeCell.controller,
    dirty: dirtyCell.controller,
  },
  factory: ({ storage, files, active, theme, dirty }, { defer }) => {
    const saved = storage.load();
    if (saved) {
      theme.set(saved.theme);
      if (saved.dirty) {
        files.set(saved.files);
        active.set(saved.active);
        dirty.set(true);
      }
    }
    const save = () =>
      storage.save({
        files: files.get(),
        active: active.get(),
        theme: theme.get(),
        dirty: dirty.get(),
      });
    defer(files.watch(save));
    defer(active.watch(save));
    defer(theme.watch(save));
    defer(dirty.watch(save));
    return { restored: saved?.dirty === true };
  },
});

/** Compiles the open files into the `bundle` cell: once on build, then debounced on every file
 * change. Runs the `compile` operation through its controller; a stale result (a newer edit
 * already queued) is dropped. An edit that leaves the bundle byte-identical (whitespace, a
 * comment) is "ready" at once — the preview keeps running, nothing reloads. Failures land in
 * `status`, never thrown past the resource. */
export const bundler = resource({
  label: "bundler",
  depends: {
    files: filesCell.controller,
    bundle: bundleCell.controller,
    status: statusCell.controller,
    compile: compile.controller,
    debounce: debounce.required,
  },
  factory: ({ files, bundle, status, compile, debounce }, { defer, clock }) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let generation = 0;
    const build = () => {
      const mine = ++generation;
      const started = clock.currentTimeMillis();
      status.set({ kind: "info", text: "compiling…" });
      compile.run({ input: files.get() }).then(
        (code) => {
          if (mine !== generation) return;
          const ms = clock.currentTimeMillis() - started;
          if (bundle.get() === code) {
            status.set({ kind: "ok", text: "ready", ms });
            return;
          }
          bundle.set(code);
          status.set({ kind: "info", text: "running…", ms });
        },
        (error: unknown) => {
          if (mine !== generation) return;
          if (!isError(error, "CompileFailed")) throw error;
          status.set({ kind: "error", text: error.payload.message });
        },
      );
    };
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(build, debounce);
    };
    build();
    defer(files.watch(schedule));
    defer(() => clearTimeout(timer));
    return { schedule };
  },
});

type Signal = { kind: "ok" } | { kind: "error"; text: string };

/** Admit a message from the preview iframe: the one shape it posts, checked at the door. */
function readSignal(raw: unknown): Signal | undefined {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { __pg, text } = raw as { __pg?: unknown; text?: unknown };
  if (__pg === "ok") return { kind: "ok" };
  if (__pg === "error")
    return { kind: "error", text: typeof text === "string" ? text : "runtime error" };
  return undefined;
}

/** Listens to the preview iframe and turns its signals into `status`; keeps the last compile time. */
export const runtime = resource({
  label: "runtime",
  depends: { status: statusCell.controller },
  factory: ({ status }, { defer }) => {
    const onMessage = (event: MessageEvent) => {
      const signal = readSignal(event.data);
      if (signal === undefined) return;
      if (signal.kind === "error") status.set({ kind: "error", text: signal.text });
      else status.update((prev) => ({ kind: "ok", text: "ready", ms: prev.ms }));
    };
    window.addEventListener("message", onMessage);
    defer(() => window.removeEventListener("message", onMessage));
    return { listening: true };
  },
});
