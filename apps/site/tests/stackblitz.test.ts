import { readdir } from "node:fs/promises";

import type { Project } from "@stackblitz/sdk";
import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { preset } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import { stackblitz } from "@/open";
import { welcomeFiles } from "@/open/files";

// The StackBlitz button sends examples/welcome as it is in the repo, on npm's packages.

const example = new URL("../../../examples/welcome/", import.meta.url);

test("the project carries each file of the example, and no more", async () => {
  const onDisk = await readdir(example, { recursive: true, withFileTypes: true });
  const own = onDisk
    .filter((e) => e.isFile())
    .map((e) => `${e.parentPath}/${e.name}`.slice(example.pathname.length))
    .filter(
      (p) =>
        /^(src|cmds|tests)\//.test(p) || ["README.md", "tsconfig.json", "tinker.graph"].includes(p),
    )
    .sort();

  expect(Object.keys(welcomeFiles).sort()).toEqual(own);
});

test("open sends the project: npm packages at Core's minor, vitest, and the StackBlitz README", async () => {
  const sent: { project: Project; file: string | string[] | undefined }[] = [];
  const blitz = stackblitz();
  const scope = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), blitz],
    presets: [
      preset(blitz.sdk, async () => ({
        openProject: (project: Project, options?: { openFile?: string | string[] }) => {
          sent.push({ project, file: options?.openFile });
        },
      })),
    ],
  }).ready;

  await scope.run(blitz.open);
  await scope.close();

  const files = new Map(sent.flatMap((s) => Object.entries(s.project.files)));
  const pkg = JSON.parse(files.get("package.json") ?? "");
  const core = await Bun.file(
    new URL("../../../packages/core/package.json", import.meta.url),
  ).text();
  const minor = JSON.parse(core).version.split(".").slice(0, 2).join(".");

  expect(sent.map((s) => [s.project.template, s.file])).toEqual([["node", "README.md"]]);
  expect(pkg.dependencies["@tinkered/core"]).toBe(`^${minor}.0`);
  expect(pkg.devDependencies["@tinkered/cli"]).toBe(`^${minor}.0`);
  expect(files.get(".stackblitzrc")).toContain('"startCommand":"npm test"');
  expect([...files.values()].join("\n")).not.toContain("vite-plus");
  expect(files.get("tests/1-signup.test.ts")).toContain('from "vitest"');
  expect(files.get("README.md")).toContain("This project runs on StackBlitz");
  expect(files.get("README.md")).not.toContain("vp run -r build");
});
