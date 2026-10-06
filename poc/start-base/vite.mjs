import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { physical, rootRoute, route } from "@tanstack/virtual-file-routes";
import react from "@vitejs/plugin-react";
import { baseDir, seam } from "./lib/paths.mjs";
import { prepare } from "./lib/prepare.mjs";

/** @param {string} root - From tinker(); why: the base reads app paths from there. */
function glueConfig(root) {
  return {
    resolve: {
      alias: [
        { find: /^@\//, replacement: `${join(root, "src")}/` },
        { find: /^#tinker\/app$/, replacement: seam(root, "tinker.ts") },
        { find: /^#tinker\/app\.server$/, replacement: seam(root, "tinker.server.ts") },
        { find: /^#tinker\/routes$/, replacement: join(root, ".tinker/routeTree.gen.ts") },
      ],
    },
    server: { host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 4318) },
    test: { server: { deps: { inline: ["@tinker/start"] } } },
  };
}

/** @param {string} root - From tinker(); why: Start takes paths relative to the app's src. */
function startOptions(root) {
  const src = join(root, "src");
  const routes = join(src, "routes");
  const fromSrc = (file) => relative(src, join(baseDir, "src", file));
  const fromRoutes = (file) => relative(routes, join(baseDir, "src", file));
  const shell = existsSync(join(routes, "__root.tsx"))
    ? "__root.tsx"
    : fromRoutes("routes/root.tsx");
  return {
    srcDirectory: "src",
    start: { entry: fromSrc("entry/start.ts") },
    server: { entry: fromSrc("entry/server.ts") },
    router: {
      entry: fromSrc("entry/router.tsx"),
      generatedRouteTree: "../.tinker/routeTree.gen.ts",
      virtualRouteConfig: rootRoute(shell, [
        route("/api/health", fromRoutes("routes/api.health.ts")),
        route("/tinker", fromRoutes("routes/tinker.tsx")),
        physical("", "."),
      ]),
    },
    importProtection: {
      behavior: "error",
      client: {
        files: [/\.server\./, /\/backend\//],
        specifiers: ["@tanstack/react-start/server", "@tinker/start/server"],
      },
      server: { files: [/\.client\./] },
    },
  };
}

/**
 * The glue: one call in the app's vite.config.ts joins the app to the base (ADR 0106).
 * @param {{ root?: string }} [options] - From vite.config.ts; why: the app folder, default cwd.
 */
export function tinker(options = {}) {
  const root = resolve(options.root ?? process.cwd());
  if (existsSync(join(root, ".env"))) process.loadEnvFile(join(root, ".env"));
  prepare(root);
  const glue = { name: "tinker:glue", config: () => glueConfig(root) };
  if (process.env.VITEST) return [glue];
  return [glue, tanstackStart(startOptions(root)), react()];
}
