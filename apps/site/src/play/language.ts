import { operation, resource } from "@tinker/core";

import { entries, library } from "./sources";
import { files } from "./state";
import type { Place } from "./state";

// Go to definition, by TypeScript's own language service (as the TypeScript playground does):
// the tabs and the library sources are its files, in memory. It loads on the first jump.

/** TypeScript's compiler API, loaded on first use: its chunk is the page's largest. */
export const typescript = resource({
  label: "play.typescript",
  factory: () => import("typescript-api"),
});

/**
 * The language service over the tabs and the library. A tab's file name is its tab name with a
 * leading `/`. An edit bumps the tabs' version, so the next jump reads the new text.
 */
export const language = resource({
  label: "play.language",
  depends: { ts: typescript, files: files.controller },
  factory: async ({ ts, files }, { defer }) => {
    let version = 0;
    defer(files.watch(() => void version++));

    const text = new Map(library.map((s) => [`/${s.name}`, s.content]));
    const read = (path: string) =>
      files.get().find((f) => `/${f.name}` === path)?.content ?? text.get(path);

    const service = ts.createLanguageService({
      getCompilationSettings: () => ({
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
        noLib: true,
        allowImportingTsExtensions: true,
        noEmit: true,
      }),
      getScriptFileNames: () => [...files.get().map((f) => `/${f.name}`), ...text.keys()],
      getScriptVersion: (path) => (text.has(path) ? "0" : String(version)),
      getScriptSnapshot: (path) => {
        const content = read(path);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => "/",
      getDefaultLibFileName: () => "/lib.d.ts",
      fileExists: (path) => read(path) !== undefined,
      readFile: read,
      resolveModuleNames: (names, from) =>
        names.map((name) => {
          const base = name.startsWith(".")
            ? `${from.slice(0, from.lastIndexOf("/"))}/${name.replace(/^\.\//, "")}`
            : `/${entries[name] ?? name}`;
          const found = ["", ".ts", ".tsx"].map((ext) => base + ext).find((p) => read(p));
          return found
            ? {
                resolvedFileName: found,
                extension: found.endsWith(".tsx") ? ts.Extension.Tsx : ts.Extension.Ts,
              }
            : undefined;
        }),
    });
    defer(() => service.dispose());
    return { service };
  },
});

/**
 * Where the name at a place is declared: a tab or a library source, at the declaration's start.
 * Null when it names nothing the editor can show (a comment, a string, a browser global).
 */
export const definition = operation({
  label: "play.definition",
  input: (raw) => raw as Place,
  depends: { language },
  run: async ({ language }, { input }): Promise<Place | null> => {
    const found = language.service
      .getDefinitionAtPosition(`/${input.file}`, input.offset)
      ?.find((d) => d.fileName !== "/lib.d.ts");
    return found ? { file: found.fileName.slice(1), offset: found.textSpan.start } : null;
  },
});
