import * as esbuild from "esbuild-wasm";
import type { Saved, Storage } from "@/state.ts";

/** A Map-backed session store: what `localStorage` does minus the browser — a save keeps a copy,
 * a load returns the copy or nothing. `seed` is the session a returning visitor left behind. */
export function fakeStorage(seed?: Saved): Storage.Handle {
  const store = new Map<string, Saved>();
  if (seed) store.set("session", structuredClone(seed));
  return {
    load: () => {
      const saved = store.get("session");
      return saved === undefined ? undefined : structuredClone(saved);
    },
    save: (saved) => store.set("session", structuredClone(saved)),
  };
}

type OnResolve = Parameters<esbuild.PluginBuild["onResolve"]>[1];
type OnLoad = Parameters<esbuild.PluginBuild["onLoad"]>[1];
type OnStart = Parameters<esbuild.PluginBuild["onStart"]>[0];
type OnEnd = Parameters<esbuild.PluginBuild["onEnd"]>[0];
type Hooks = { resolve: OnResolve[]; load: OnLoad[]; start: OnStart[]; end: OnEnd[]; name: string };
type Resolved = { path: string; namespace: string };

/** Fail the way esbuild's JS API does: a `BuildFailure` whose message lines carry `ERROR:`. */
function fail(importer: string, name: string, messages: esbuild.PartialMessage[]): never {
  const errors = messages.map((m): esbuild.Message => ({
    id: "",
    pluginName: name,
    text: m.text ?? "",
    location: null,
    notes: [],
    detail: undefined,
  }));
  const lines = errors.map((e) => `${importer}:1:0: ERROR: [plugin: ${name}] ${e.text}`);
  const failure: esbuild.BuildFailure = Object.assign(
    new Error(`Build failed with ${lines.length} error:\n${lines.join("\n")}`),
    { errors, warnings: [] },
  );
  throw failure;
}

/** Resolve one specifier through the registered hooks: a path in a namespace, or nothing (external). */
async function readResolved(
  hooks: Hooks,
  path: string,
  importer: string,
  kind: esbuild.ImportKind,
): Promise<Resolved | undefined> {
  const args = {
    path,
    importer,
    namespace: "vfs",
    resolveDir: "",
    kind,
    pluginData: undefined,
    with: {},
  };
  for (const hook of hooks.resolve) {
    const found = await hook(args);
    if (!found) continue;
    if (found.errors?.length) fail(importer, hooks.name, found.errors);
    return found.external
      ? undefined
      : { path: found.path ?? path, namespace: found.namespace ?? "" };
  }
  return undefined;
}

/** Load one resolved module's source through the registered hooks. */
async function readLoaded(hooks: Hooks, path: string, namespace: string): Promise<string> {
  for (const hook of hooks.load) {
    const loaded = await hook({ path, namespace, suffix: "", pluginData: undefined, with: {} });
    if (!loaded) continue;
    if (loaded.errors?.length) fail(path, hooks.name, loaded.errors);
    const contents = loaded.contents ?? "";
    return typeof contents === "string" ? contents : new TextDecoder().decode(contents);
  }
  return "";
}

/** Walk the module graph from `entry` like a bundler: each reachable module once, in load order. */
async function readModules(hooks: Hooks, entry: string): Promise<string[]> {
  const out: string[] = [];
  const visited = new Set<string>();
  const visit = async (path: string, importer: string, kind: esbuild.ImportKind): Promise<void> => {
    const found = await readResolved(hooks, path, importer, kind);
    if (found === undefined || visited.has(found.path)) return;
    visited.add(found.path);
    const source = await readLoaded(hooks, found.path, found.namespace);
    out.push(source);
    for (const [, specifier] of source.matchAll(/^import\b[^"']*["']([^"']+)["']/gm)) {
      await visit(specifier, found.path, "import-statement");
    }
  };
  await visit(entry, "", "entry-point");
  return out;
}

/** What `PluginBuild.resolve` answers: the hooks' verdict in esbuild's result shape. */
async function readResolveResult(hooks: Hooks, path: string): Promise<esbuild.ResolveResult> {
  const found = await readResolved(hooks, path, "", "import-statement");
  return {
    errors: [],
    warnings: [],
    path: found?.path ?? path,
    external: found === undefined,
    sideEffects: true,
    namespace: found?.namespace ?? "",
    suffix: "",
    pluginData: undefined,
  };
}

/** Register every plugin's hooks the way esbuild does before a build starts. */
async function readHooks(options: esbuild.BuildOptions, sdk: typeof esbuild): Promise<Hooks> {
  const hooks: Hooks = { resolve: [], load: [], start: [], end: [], name: "" };
  const plugin: esbuild.PluginBuild = {
    initialOptions: options,
    resolve: (path) => readResolveResult(hooks, path),
    onStart: (callback) => hooks.start.push(callback),
    onEnd: (callback) => hooks.end.push(callback),
    onDispose: () => undefined,
    onResolve: (_options, callback) => hooks.resolve.push(callback),
    onLoad: (_options, callback) => hooks.load.push(callback),
    esbuild: sdk,
  };
  for (const p of options.plugins ?? []) {
    hooks.name = p.name;
    await p.setup(plugin);
  }
  return hooks;
}

/** The one entry point the shell builds from; the other option shapes are never passed. */
function readEntry(options: esbuild.BuildOptions): string {
  const [entry] = Array.isArray(options.entryPoints) ? options.entryPoints : [];
  return typeof entry === "string" ? entry : "";
}

/** A fake esbuild-wasm: the real module with `build` replaced. `build` runs the plugins like the
 * real one (start hooks, entry point, relative imports, bare specifiers external, end hooks), then
 * emits the reachable modules joined in load order instead of a real bundle; a missing import
 * rejects with esbuild's `BuildFailure`. Any other API is the un-booted real one. `seen` records
 * each emitted bundle; `gate` parks a build until the test lets it through. */
export function fakeEsbuild(seen: string[], gate?: () => Promise<void>): typeof esbuild {
  const build = async (options: esbuild.BuildOptions): Promise<esbuild.BuildResult> => {
    const hooks = await readHooks(options, sdk);
    for (const start of hooks.start) await start();
    const text = (await readModules(hooks, readEntry(options))).join("\n");
    seen.push(text);
    await gate?.();
    const result: esbuild.BuildResult = {
      errors: [],
      warnings: [],
      outputFiles: [
        { path: "bundle.js", contents: new TextEncoder().encode(text), hash: "", text },
      ],
      metafile: { inputs: {}, outputs: {} },
      mangleCache: {},
    };
    for (const end of hooks.end) await end(result);
    return result;
  };
  const sdk: typeof esbuild = { ...esbuild, build };
  return sdk;
}
