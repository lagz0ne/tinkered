import { relative } from "node:path";

import type { Plugin } from "vite-plus";

/**
 * Server code, by the name an import gives it or the file it resolves to (ADR 0160 decision 3).
 * `@tinkered/bun/client` is the one entry of `@tinkered/bun` a page may import.
 */
const serverCode = [
  /\.server\.[cm]?[jt]sx?$/,
  /^(?:bun|node):/,
  /^@tinkered\/entry(?:\/|$)/,
  /^@tinkered\/bun(?!\/client$)(?:\/|$)/,
];

/**
 * The page guard (ADR 0160): the page build stops at an import of server code, however deep
 * the re-export that reaches it. It runs only where the page is built, the client environment,
 * so a server build is not touched. `import type` is erased before any import resolves, so a
 * page may still take types from a server file.
 */
export function pageGuard(): Plugin {
  return {
    name: "tinker:page-guard",
    enforce: "pre",
    applyToEnvironment: (environment) => environment.config.consumer === "client",
    async resolveId(source, importer, options) {
      if (!importer) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });

      const id = resolved?.id ?? source;
      if (serverCode.some((code) => code.test(source) || code.test(id))) {
        const from = relative(this.environment.config.root, importer).replaceAll("\\", "/");
        this.error(`page imports server code "${source}" from ${from}`);
      }
      return resolved;
    },
  };
}
