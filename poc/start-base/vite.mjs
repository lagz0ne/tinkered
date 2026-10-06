import { existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { say as routeSay } from "./lib/checks/routes.mjs";
import { buildChecks } from "./lib/doctor.mjs";
import { loadEnv } from "./lib/env.mjs";
import { aliases, passThrough, startOptions } from "./lib/glue.mjs";
import { appFiles, shellFile } from "./lib/named.mjs";
import { prepare } from "./lib/prepare.mjs";
import { checkTypes } from "./lib/typecheck.mjs";

/** @param {string} root - From tinker(); why: the app's paths, address, and tsconfig. */
function glueConfig(root) {
  const address = { host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 4318) };
  return {
    resolve: { alias: aliases(root) },
    server: address,
    preview: address,
    tsconfig: join(root, ".tinker/tsconfig.json"),
    test: { server: { deps: { inline: ["@tinker/start"] } } },
  };
}

/**
 * Keep every import boundary violation of this run in .tinker/, for doctor (Start stops at the first).
 * @param {string} root - From tinker(); why: the app's generated folder.
 */
function recordViolations(root) {
  const path = join(root, ".tinker/violations.json");
  const found = new Map();
  writeFileSync(path, "[]\n");
  return (info) => {
    const at = info.importerLoc ? `:${info.importerLoc.line}:${info.importerLoc.column}` : "";
    const importer = `${relative(root, info.importer)}${at}`;
    found.set(`${importer} ${info.specifier}`, {
      env: info.envType,
      importer,
      specifier: info.specifier,
      rule: String(info.pattern ?? info.type),
    });
    writeFileSync(path, JSON.stringify([...found.values()], null, 2) + "\n");
  };
}

/**
 * At build start, run doctor's static checks, then the app's tsc: a known mistake stops the
 * build with doctor's file:line message instead of shipping.
 * @param {string} root - From tinker(); why: the app being built.
 */
function verify(root) {
  let done = false;
  return {
    name: "tinker:verify",
    apply: "build",
    buildStart() {
      if (done) return;
      done = true;
      const { errors, warnings } = buildChecks(root);
      for (const line of warnings) this.warn(line);
      if (errors.length > 0) this.error(errors.join("\n"));
      const types = checkTypes(root);
      if (types.length > 0) this.error(types.join("\n"));
    },
  };
}

/**
 * Start reads the shell, the named files, and the seam files once, at config time: restart
 * dev when one is added or removed, so the running server never serves a stale pick.
 * @param {string} root - From tinker(); why: watch that app's picked files.
 */
function restartOn(root) {
  const watched = new Set(
    [shellFile, ...appFiles.map(({ file }) => file)].map((file) => join(root, file)),
  );
  return {
    name: "tinker:restart",
    apply: "serve",
    configureServer(server) {
      const restart = (verb) => (path) => {
        if (!watched.has(path)) return;
        server.config.logger.info(`tinker: ${relative(root, path)} ${verb}; restarting`, {
          timestamp: true,
        });
        void server.restart();
      };
      server.watcher.on("add", restart("added"));
      server.watcher.on("unlink", restart("removed"));
    },
  };
}

/**
 * Tailwind's Vite plugin, when the app installs it: a registry item cannot edit
 * vite.config.ts, so the base adds the plugin, and the app owns the version.
 * @param {string} root - From tinker(); why: resolve @tailwindcss/vite from the app.
 */
async function tailwind(root) {
  let path;
  try {
    path = createRequire(join(root, "package.json")).resolve("@tailwindcss/vite");
  } catch {
    return null;
  }
  return (await import(pathToFileURL(path).href)).default();
}

/**
 * The glue: one call in the app's vite.config.ts joins the app to the base (ADR 0106).
 * @param {{ root?: string, prerender?: object, pages?: object[], spa?: object, sitemap?: object }} [options] - From vite.config.ts; why: the app folder (default cwd) and Start's static output options.
 */
export function tinker(options = {}) {
  const passed = passThrough(options);
  const root = resolve(options.root ?? process.cwd());
  loadEnv(root);
  if (!existsSync(join(root, "src/routes"))) throw new Error(`tinker: ${routeSay.missing}`);
  prepare(root);
  const glue = { name: "tinker:glue", config: () => glueConfig(root) };
  const own = startOptions(root);
  const start = tanstackStart({
    ...own,
    ...passed,
    importProtection: { ...own.importProtection, onViolation: recordViolations(root) },
  });
  if (process.env.VITEST) return [glue, start];
  return [glue, verify(root), restartOn(root), start, react(), tailwind(root)];
}
