import { operation, resource } from "@tinkered/core";
import type { Plugin } from "esbuild-wasm";
import { z } from "zod";

import {
  bundle,
  debounce,
  dirty,
  entry,
  files,
  inbox,
  nav,
  saved,
  status,
  storage,
  theme,
  wasm,
} from "./state";
import type { PlayFile } from "./state";

// The play page's effects, each a resource: the page resolves it, the scope closes it, and its
// `defer` undoes it. React holds no effect of its own.

/** esbuild-wasm, loaded on first use: the play chunk carries it, the site's first page does not. */
export const esbuild = resource({ label: "play.esbuild", factory: () => import("esbuild-wasm") });

/** esbuild, started. The browser starts it from the wasm file; Bun needs no start. */
export const started = resource({
  label: "play.esbuild.started",
  depends: { esbuild, wasm: wasm.required },
  factory: async ({ esbuild, wasm }) => {
    if (wasm !== null) await esbuild.initialize({ wasmURL: wasm });
    return true;
  },
});

/** What a compile gives: the bundle, or esbuild's words. A broken file is a value, not a throw. */
export type Compiled = { ok: true; code: string } | { ok: false; message: string };

/**
 * The esbuild plugin that reads the tabs: a relative import finds a tab, with or without its
 * extension; a bare import stays for the preview's import map.
 */
export const tabs = operation({
  label: "play.tabs",
  input: (raw) => raw as PlayFile[],
  run: (_, { input }): Plugin => {
    const byName = new Map(input.map((f) => [f.name, f.content]));
    return {
      name: "tabs",
      setup: (build) => {
        build.onResolve({ filter: /.*/ }, (args) => {
          if (args.kind === "entry-point") return { path: args.path, namespace: "tabs" };
          if (!args.path.startsWith(".")) return { path: args.path, external: true };

          const base = args.path.replace(/^\.\//, "");
          const found = ["", ".tsx", ".ts", ".jsx", ".js"]
            .map((ext) => base + ext)
            .find((n) => byName.has(n));
          return found
            ? { path: found, namespace: "tabs" }
            : { errors: [{ text: `No tab named "${args.path}"` }] };
        });
        build.onLoad({ filter: /.*/, namespace: "tabs" }, (args) => ({
          contents: byName.get(args.path) ?? "",
          loader: args.path.endsWith(".ts") ? "ts" : "tsx",
        }));
      },
    };
  },
});

/** Bundles the tabs from `main.tsx` into one ES module. */
export const compile = operation({
  label: "play.compile",
  input: z.array(z.object({ name: z.string(), content: z.string() })),
  depends: { esbuild, started, tabs: tabs.controller },
  run: async ({ esbuild, tabs }, { input }): Promise<Compiled> => {
    try {
      const result = await esbuild.build({
        entryPoints: [entry],
        bundle: true,
        write: false,
        format: "esm",
        platform: "browser",
        target: "es2022",
        jsx: "automatic",
        logLevel: "silent",
        plugins: [tabs.run({ input })],
      });
      return { ok: true, code: result.outputFiles[0]!.text };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, message: message.replace(/^.*?ERROR:\s*/s, "") };
    }
  },
});

/**
 * Compiles what is open into `bundle`. A result for files that changed since is dropped: the
 * newer compile is on its way. A bundle equal to the last one is "ready" at once; nothing reloads.
 */
export const rebuild = operation({
  label: "play.rebuild",
  depends: {
    files: files.controller,
    bundle: bundle.controller,
    status: status.controller,
    compile: compile.controller,
  },
  run: async ({ files, bundle, status, compile }, { clock }) => {
    const asked: PlayFile[] = files.get();
    const started = clock.currentTimeMillis();
    status.set({ kind: "info", text: "compiling…" });

    const out = await compile.run({ input: asked });
    if (files.get() !== asked) return;

    const ms = clock.currentTimeMillis() - started;
    if (!out.ok) status.set({ kind: "error", text: out.message });
    else if (bundle.get() === out.code) status.set({ kind: "ok", text: "ready", ms });
    else {
      bundle.set(out.code);
      status.set({ kind: "info", text: "running…", ms });
    }
  },
});

/** Compiles once at start, then after each edit and `debounce` ms of quiet. */
export const bundler = resource({
  label: "play.bundler",
  depends: { files: files.controller, rebuild: rebuild.controller, debounce: debounce.required },
  factory: ({ files, rebuild, debounce }, { defer, clock, signal }) => {
    let quiet = new AbortController();
    void rebuild.run();

    defer(
      files.watch(() => {
        quiet.abort();
        quiet = new AbortController();
        clock.sleep(debounce, AbortSignal.any([quiet.signal, signal])).then(
          () => rebuild.run(),
          () => undefined,
        );
      }),
    );
    defer(() => quiet.abort());
    return { debounce };
  },
});

const key = "tinker-site:play:v1";

/**
 * Brings back a changed session from `storage`, then keeps every later change there. A clean
 * session gives back only its theme: a newer starter reaches a returning visitor.
 */
export const persistence = resource({
  label: "play.persistence",
  depends: {
    storage: storage.required,
    files: files.controller,
    nav: nav.controller,
    dirty: dirty.controller,
    theme: theme.controller,
  },
  factory: ({ storage, files, nav, dirty, theme }, { defer }) => {
    let raw: unknown = null;
    try {
      raw = JSON.parse(storage.getItem(key) ?? "null");
    } catch {
      raw = null;
    }

    const kept = saved.safeParse(raw);
    const restored = kept.success && kept.data.dirty;
    if (kept.success) theme.set(kept.data.theme);
    if (restored) {
      const { files: list, active } = kept.data;
      files.set(list);
      nav.set({
        place: { file: list.some((f) => f.name === active) ? active : list[0]!.name, offset: 0 },
        back: [],
        forward: [],
      });
      dirty.set(true);
    }

    const save = () =>
      storage.setItem(
        key,
        JSON.stringify({
          files: files.get(),
          active: nav.get().place.file,
          dirty: dirty.get(),
          theme: theme.get(),
        }),
      );
    defer(files.watch(save));
    defer(nav.watch(save));
    defer(dirty.watch(save));
    defer(theme.watch(save));
    return { restored };
  },
});

/** What the preview posts: it ran, or it threw. */
const signalled = z.union([
  z.object({ tinkerPlay: z.literal("ok") }),
  z.object({ tinkerPlay: z.literal("error"), text: z.string() }),
]);

/** Listens to the preview frame and turns what it posts into `status`. */
export const preview = resource({
  label: "play.preview",
  depends: { status: status.controller, inbox: inbox.required },
  factory: ({ status, inbox }, { defer }) => {
    const heard = (event: Event) => {
      const said = signalled.safeParse((event as MessageEvent).data);
      if (!said.success) return;
      if ("text" in said.data) status.set({ kind: "error", text: said.data.text });
      else status.update((s) => ({ kind: "ok", text: "ready", ms: s.ms }));
    };
    inbox.addEventListener("message", heard);
    defer(() => inbox.removeEventListener("message", heard));
    return { listening: true };
  },
});
