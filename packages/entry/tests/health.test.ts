import { createScope } from "@tinkered/core";
import type { Observe } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { baseVersion, health } from "@/server";

test("the base version is the package version in package.json", async () => {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();

  expect(baseVersion).toBe(pkg.version);
});

test("health answers ok with the base version, in a span named tinker.health", async () => {
  const spans: Observe.Span[] = [];
  const app = createScope({ observe: { export: (span) => void spans.push(span) } });
  await app.ready;

  const answer = app.run(health, {});

  expect(answer).toEqual({ ok: true, base: baseVersion });
  expect(spans.map((span) => span.name)).toEqual(["tinker.health"]);
  await app.close();
});
