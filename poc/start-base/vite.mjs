import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { say as routeSay } from "./lib/checks/routes.mjs";
import { loadEnv } from "./lib/env.mjs";
import { aliases, passThrough, startOptions } from "./lib/glue.mjs";
import { recordViolation, restartNote, startViolations, verifyBuild } from "./lib/hooks.mjs";
import { prepare } from "./lib/prepare.mjs";

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
 * At build start, doctor's static checks, then the app's tsc: a known mistake stops the build
 * with doctor's file:line line instead of shipping. Once they pass, this build's boundary
 * record starts empty; Start's onViolation fills it.
 * @param {string} root - From tinker(); why: the app being built.
 * @param {{ found?: Map<string, object> }} record - From tinker(); why: shared with onViolation.
 */
function verify(root, record) {
  let done = false;
  return {
    name: "tinker:verify",
    apply: "build",
    buildStart() {
      if (done) return;
      done = true;
      const { errors, warnings } = verifyBuild(root);
      for (const line of warnings) this.warn(line);
      if (errors.length > 0) this.error(errors.join("\n"));
      record.found = startViolations(root);
    },
  };
}

/**
 * Restart dev when a picked file comes or goes (see restartNote).
 * @param {string} root - From tinker(); why: watch that app's picked files.
 */
function restartOn(root) {
  return {
    name: "tinker:restart",
    apply: "serve",
    configureServer(server) {
      const restart = (verb) => (path) => {
        const note = restartNote(root, path, verb);
        if (!note) return;
        server.config.logger.info(note, { timestamp: true });
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
  const record = {};
  /** Returns nothing: Start drops a violation whose hook returns false. */
  const onViolation = (info) => {
    if (record.found) recordViolation(root, record.found, info);
  };
  const start = tanstackStart({
    ...own,
    ...passed,
    importProtection: { ...own.importProtection, onViolation },
  });
  if (process.env.VITEST) return [glue, start];
  return [glue, verify(root, record), restartOn(root), start, react(), tailwind(root)];
}
