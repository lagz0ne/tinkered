import type { Project } from "@stackblitz/sdk";
import { capsule, operation, resource } from "@tinkered/core";
import { z } from "zod";

import { corePackage, welcomeFiles } from "./files";

// StackBlitz runs a project in a browser tab on Node (WebContainers). It installs from npm and runs
// JS and wasm only, so the project takes the published packages, vitest and tsx; vite-plus and
// oxlint need native binaries, so `vp`, lint and `tinker check` stay on a real machine.

/** The StackBlitz SDK's `openProject`, loaded on first open: the site's first page does not carry it. */
export const sdk = resource({
  label: "stackblitz.sdk",
  factory: () => import("@stackblitz/sdk").then((m) => ({ openProject: m.default.openProject })),
});

/** Where the example's README says how to run it in the repo, and what StackBlitz says instead. */
const runHeading = "## Run";

const runHere = `## Run

This project runs on StackBlitz, in Node in
your tab. \`npm test\` runs at start and runs
again on each save.

\`\`\`bash
npm test           # the 6 steps, and the trace
npm run graph      # tinker.graph: each op, each hook
npm start          # the cmd: 3 sign-ups, then close
npm run typecheck
\`\`\`

\`tinker check\` and lint need native tools.
Run them on your machine, in the repo:
\`examples/welcome\`.
`;

/** Vitest with the example's \`@/\` alias: what \`vp test\` does in the repo. */
const vitestConfig = `import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("src", import.meta.url)) },
  },
  test: { include: ["tests/**/*.test.ts"] },
});
`;

/**
 * The welcome mail example as a StackBlitz project: the repo's files, the packages at Core's
 * current minor from npm, and plain vitest in place of vite-plus.
 */
export const project = operation({
  label: "stackblitz.project",
  run: (): Project => {
    const { version } = z.object({ version: z.string() }).parse(JSON.parse(corePackage));
    const range = `^${version.split(".").slice(0, 2).join(".")}.0`;

    const files = Object.fromEntries(
      Object.entries(welcomeFiles).map(([path, text]) => [
        path,
        text.replaceAll('from "vite-plus/test"', 'from "vitest"'),
      ]),
    );
    const readme = welcomeFiles["README.md"] ?? "";
    const intro = readme.slice(0, readme.indexOf(runHeading));

    const pkg = {
      name: "tinker-welcome-mail",
      private: true,
      type: "module",
      scripts: {
        test: "vitest",
        graph: "tinker graph",
        start: "tsx cmds/server.ts",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        "@tinkered/core": range,
        "@tinkered/devtools": range,
        zod: "^4.0.0",
      },
      devDependencies: {
        "@tinkered/cli": range,
        "@types/node": "^24.0.0",
        tsx: "^4.20.0",
        typescript: "^5.9.0",
        vitest: "^4.0.0",
      },
    };

    return {
      title: "Tinker: welcome mail",
      description: "A welcome mail built from capsules: tests, graph and trace.",
      template: "node",
      files: {
        ...files,
        "README.md": `${intro}${runHere}`,
        "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
        "vitest.config.ts": vitestConfig,
        "tinker.json": `${JSON.stringify({ tests: "vitest run" })}\n`,
        // npm's peer resolver fails on @tinkered/cli beside vitest; the legacy one installs it.
        ".npmrc": "legacy-peer-deps=true\n",
        ".gitignore": "node_modules\ndist\n",
        ".stackblitzrc": `${JSON.stringify({ installDependencies: true, startCommand: "npm test" })}\n`,
      },
    };
  },
});

/** Opens the project on StackBlitz in this tab. */
export const open = operation({
  label: "stackblitz.open",
  depends: { sdk, project: project.controller },
  run: async ({ sdk, project }) => {
    sdk.openProject(await project.run(), { openFile: "README.md", newWindow: false });
  },
});

/**
 * The StackBlitz door: `open` sends examples/welcome to StackBlitz, where its tests, graph and
 * cmd run in Node in the visitor's tab.
 * - `project`: the project it sends.
 * - `sdk`: the StackBlitz SDK's `openProject`; a test swaps it.
 */
export const stackblitz = capsule({
  label: "stackblitz",
  exports: { open, project, sdk },
});
