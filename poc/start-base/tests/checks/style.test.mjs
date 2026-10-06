import { expect, test } from "vite-plus/test";
import { style } from "../../lib/checks/style.mjs";
import { prepare } from "../../lib/prepare.mjs";
import { goodApp } from "../fixture.mjs";

const tailwindInstalled = {
  "node_modules/tailwindcss/package.json": JSON.stringify({ version: "4.0.0" }),
  "node_modules/@tailwindcss/vite/package.json": JSON.stringify({ version: "4.0.0" }),
};
const shadcn = (settings) =>
  JSON.stringify(
    { tailwind: { css: "src/style.css" }, aliases: { ui: "@/components/ui" }, ...settings },
    null,
    2,
  );

test("passes when the shell links src/style.css and no stylesheet sits unlinked", () => {
  const root = goodApp({
    "src/style.css": '@import "./theme.css";\n',
    "src/theme.css": "",
    "src/frontend/card.css": "",
    "src/frontend/card.tsx": 'import "./card.css";\n',
  });
  expect(style(root)).toEqual({
    status: "ok",
    lines: ["src/style.css is linked by the shell; every stylesheet is linked"],
  });
});

test("names a user shell that does not link src/style.css", () => {
  const root = goodApp({
    "src/style.css": "",
    "src/routes/__root.tsx": "export const Route = 1;\n",
  });
  expect(style(root).lines).toEqual([
    'src/routes/__root.tsx:1 replaces the base shell and does not link src/style.css; import style from "../style.css?url" and add { rel: "stylesheet", href: style } to head links',
  ]);
  const linked = goodApp({
    "src/style.css": "",
    "src/routes/__root.tsx": 'import style from "../style.css?url";\n',
  });
  expect(style(linked).status).toBe("ok");
});

test("names a stylesheet nothing links", () => {
  expect(style(goodApp({ "src/styles.css": "" })).lines).toEqual([
    "src/styles.css:1 is never linked: nothing imports it, and the shell links only src/style.css",
  ]);
});

test("names each Tailwind package a stylesheet needs and the app lacks", () => {
  const root = goodApp({ "src/style.css": '/* app */\n@import "tailwindcss";\n' });
  expect(style(root).lines).toEqual([
    "src/style.css:2 imports tailwindcss, but tailwindcss is not installed; tinker() adds Tailwind when it is",
    "src/style.css:2 imports tailwindcss, but @tailwindcss/vite is not installed; tinker() adds Tailwind when it is",
  ]);
});

test("passes shadcn when its aliases land in src/ and Tailwind runs from src/style.css", () => {
  const root = goodApp({
    ...tailwindInstalled,
    "components.json": shadcn({}),
    "src/style.css": '@import "tailwindcss";\n',
  });
  prepare(root);
  expect(style(root).status).toBe("ok");
});

test("names a shadcn alias that lands outside src/, as a relative path did", () => {
  const root = goodApp({
    ...tailwindInstalled,
    "components.json": shadcn({}),
    "src/style.css": '@import "tailwindcss";\n',
    ".tinker/tsconfig.json": JSON.stringify({
      compilerOptions: { paths: { "@/*": ["../src/*"] } },
    }),
  });
  expect(style(root).lines).toEqual([
    'components.json:6 aliases.ui "@/components/ui" lands at ../src/components/ui, outside src/; shadcn writes there',
  ]);
});

test("names a shadcn alias with no path, a CSS file the base does not link, and a missing stylesheet", () => {
  const root = goodApp({
    ...tailwindInstalled,
    "components.json": shadcn({ tailwind: { css: "src/app.css" }, aliases: { ui: "~/ui" } }),
  });
  prepare(root);
  expect(style(root).lines).toEqual([
    'components.json:6 aliases.ui "~/ui" matches no tsconfig path',
    'components.json:3 tailwind.css is "src/app.css"; the base links src/style.css',
    'src/style.css is missing; components.json needs it, with @import "tailwindcss"',
  ]);
});

test("names a shadcn stylesheet without Tailwind", () => {
  const root = goodApp({ "components.json": shadcn({}), "src/style.css": "body {}\n" });
  prepare(root);
  expect(style(root).lines).toEqual([
    'src/style.css:1 does not @import "tailwindcss"; shadcn needs Tailwind',
  ]);
});
