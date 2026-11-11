import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";

import { play } from "@/play";
import { addFile, closeFile, editFile, renameFile, reset } from "@/play/ops";
import { setTheme } from "@/play/ops";
import { bundler, compile, persistence, preview } from "@/play/services";
import { bundle, dirty, entry, files, nav, starter, status, theme } from "@/play/state";

// The playground at its seam: real esbuild (Bun runs it with no wasm file), a Map as the storage,
// and the scope's own clock. The lint's one-door rule is for features; a test reads the files.

/** Web Storage over a Map, so a test reads what was kept. */
const memory = (seed: Record<string, string> = {}) => {
  const kept = new Map(Object.entries(seed));
  return {
    kept,
    getItem: (k: string) => kept.get(k) ?? null,
    setItem: (k: string, v: string) => void kept.set(k, v),
  };
};

const start = async (store = memory(), debounce = 5) => {
  const inbox = new EventTarget();
  const app = createScope({ capsules: [play({ storage: store, debounce, wasm: null, inbox })] });
  return { scope: await app.ready, store, inbox };
};

/** What the preview frame posts to the page. */
const say = (inbox: EventTarget, data: unknown) =>
  inbox.dispatchEvent(new MessageEvent("message", { data }));

/** Waits for the bundler's first compile to land. */
const compiled = async (scope: Awaited<ReturnType<typeof start>>["scope"]) => {
  scope.resolve(bundler);
  await expect.poll(() => scope.controller(status).get().text).toBe("running…");
  return scope.controller(bundle).get();
};

test("the starter project compiles to one module, bare imports kept for the import map", async () => {
  const { scope } = await start();
  const out = await scope.run(compile, { input: starter });

  expect(out.ok).toBe(true);
  if (!out.ok) return;
  expect(out.code).toContain('from "@tinker/core"');
  expect(out.code).toContain('from "react-dom/client"');
  expect(out.code).not.toContain('from "./engine"');
});

test("a broken tab is a value with esbuild's words, not a throw", async () => {
  const { scope } = await start();
  const broken = await scope.run(compile, { input: [{ name: entry, content: "x(" }] });
  const missing = await scope.run(compile, {
    input: [{ name: entry, content: 'import { x } from "./gone";\nx();' }],
  });

  expect(broken).toEqual({ ok: false, message: "Unexpected end of file" });
  expect(missing).toEqual({ ok: false, message: expect.stringContaining('No tab named "./gone"') });
});

test("the bundler compiles at start, and again after an edit and a quiet spell", async () => {
  const { scope } = await start();
  scope.resolve(bundler);
  await expect.poll(() => scope.controller(status).get().text).toBe("running…");
  const first = scope.controller(bundle).get();
  expect(first).toContain("createRoot");

  scope.run(editFile, {
    input: { name: "Tile.tsx", content: "export const Tile = () => null;\n" },
  });
  await expect.poll(() => scope.controller(bundle).get()).not.toBe(first);
  expect(scope.controller(bundle).get()).not.toContain("PER_UNIT");
});

test("an edit that breaks the build shows the error and keeps the last good bundle", async () => {
  const { scope } = await start();
  scope.resolve(bundler);
  await expect.poll(() => scope.controller(status).get().text).toBe("running…");
  const good = scope.controller(bundle).get();

  scope.run(editFile, { input: { name: entry, content: "let = ;" } });
  await expect.poll(() => scope.controller(status).get().kind).toBe("error");
  expect(scope.controller(bundle).get()).toBe(good);
});

test("tabs: add takes the first free name, close moves to the neighbour, the last stays", async () => {
  const { scope } = await start();
  expect(scope.run(addFile)).toBe("Untitled1.tsx");
  expect(scope.run(addFile)).toBe("Untitled2.tsx");
  expect(scope.controller(nav).get().place.file).toBe("Untitled2.tsx");

  expect(scope.run(closeFile, { input: "Untitled2.tsx" })).toBe(true);
  expect(scope.controller(nav).get().place.file).toBe("Untitled1.tsx");
  for (const f of scope.controller(files).get().slice(1)) scope.run(closeFile, { input: f.name });
  expect(scope.run(closeFile, { input: entry })).toBe(false);
  expect(
    scope
      .controller(files)
      .get()
      .map((f) => f.name),
  ).toEqual([entry]);
});

test("rename refuses a taken name and carries the tab on screen", async () => {
  const { scope } = await start();
  expect(scope.run(renameFile, { input: { from: entry, to: "App.tsx" } })).toBe(false);
  expect(scope.run(renameFile, { input: { from: entry, to: "start.tsx" } })).toBe(true);
  expect(scope.controller(nav).get().place.file).toBe("start.tsx");
});

test("a changed session comes back; a clean one yields to the starter", async () => {
  const first = await start();
  first.scope.resolve(persistence);
  first.scope.run(editFile, { input: { name: entry, content: "// mine" } });
  const kept = Object.fromEntries(first.store.kept);

  const again = await start(memory(kept));
  again.scope.resolve(persistence);
  expect(again.scope.controller(files).get()[0]!.content).toBe("// mine");
  expect(again.scope.controller(dirty).get()).toBe(true);

  again.scope.run(reset);
  const clean = await start(memory(Object.fromEntries(again.store.kept)));
  clean.scope.resolve(persistence);
  expect(clean.scope.controller(files).get()).toEqual(starter);
});

test("a kept session that does not parse is no session", async () => {
  const { scope } = await start(memory({ "tinker-site:play:v1": "{not json" }));
  expect(scope.resolve(persistence).restored).toBe(false);
  expect(scope.controller(files).get()).toEqual(starter);
});

test("the newer of two quick edits wins; the older compile's result is dropped", async () => {
  const { scope } = await start();
  await compiled(scope);

  scope.run(editFile, {
    input: { name: "Tile.tsx", content: 'export const Tile = () => "older";' },
  });
  await new Promise((r) => setTimeout(r, 8));
  scope.run(editFile, {
    input: { name: "Tile.tsx", content: 'export const Tile = () => "newer";' },
  });

  await expect.poll(() => scope.controller(bundle).get()).toContain("newer");
  await new Promise((r) => setTimeout(r, 50));
  expect(scope.controller(bundle).get()).not.toContain("older");
});

test("an edit that leaves the bundle as it was is ready at once; nothing reloads", async () => {
  const { scope } = await start();
  const first = await compiled(scope);

  const tile = scope
    .controller(files)
    .get()
    .find((f) => f.name === "Tile.tsx")!;
  scope.run(editFile, { input: { name: "Tile.tsx", content: `${tile.content}\n\n` } });
  await expect.poll(() => scope.controller(status).get().text).toBe("ready");
  expect(scope.controller(bundle).get()).toBe(first);
});

test("a released bundler compiles no more: an edit made before the release never lands", async () => {
  const { scope } = await start(memory(), 30);
  const first = await compiled(scope);

  scope.run(editFile, { input: { name: "Tile.tsx", content: "export const Tile = () => 1;" } });
  scope.release(bundler);
  await new Promise((r) => setTimeout(r, 80));
  expect(scope.controller(bundle).get()).toBe(first);
});

test("the preview's ok keeps the compile time; its error becomes the status", async () => {
  const { scope, inbox } = await start();
  scope.resolve(preview);
  scope.controller(status).set({ kind: "info", text: "running…", ms: 42 });

  say(inbox, { tinkerPlay: "ok" });
  expect(scope.controller(status).get()).toEqual({ kind: "ok", text: "ready", ms: 42 });
  say(inbox, { tinkerPlay: "error", text: "boom is not defined" });
  expect(scope.controller(status).get()).toEqual({ kind: "error", text: "boom is not defined" });
});

test("a message of another shape is not the preview's; a released preview hears nothing", async () => {
  const { scope, inbox } = await start();
  scope.resolve(preview);
  const before = scope.controller(status).get();

  say(inbox, { other: "app" });
  expect(scope.controller(status).get()).toBe(before);
  scope.release(preview);
  say(inbox, { tinkerPlay: "error", text: "late" });
  expect(scope.controller(status).get()).toBe(before);
});

test("a clean session gives back only its theme", async () => {
  const first = await start();
  first.scope.resolve(persistence);
  first.scope.run(setTheme, { input: "one-dark" });
  const kept = Object.fromEntries(first.store.kept);

  const again = await start(memory(kept));
  again.scope.resolve(persistence);
  expect(again.scope.controller(theme).get()).toBe("one-dark");
  expect(again.scope.controller(dirty).get()).toBe(false);
  expect(again.scope.controller(files).get()).toEqual(starter);
});

test("an unknown theme is refused at the door", async () => {
  const { scope } = await start();
  expect(() => scope.run(setTheme, { rawInput: "solarized" })).toThrow();
  expect(scope.controller(theme).get()).toBe("github-light");
});
