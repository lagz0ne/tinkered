import { expect, test } from "vite-plus/test";
import { createScope, preset } from "@tinker/core";
import { draft, save, saveDraft, typeDraft } from "./index.ts";

test("typing then saving posts once and clears the draft", async () => {
  const seen: string[] = [];
  const stop = new AbortController();
  const scope = createScope({
    signal: stop.signal,
    presets: [
      preset(save, (_deps, ctx) => {
        seen.push("post");
        return Promise.resolve(ctx.input);
      }),
    ],
  });
  try {
    await scope.ready;
    scope.run(typeDraft, { input: { title: "x" } });
    expect(scope.resolve(draft)).toEqual({ title: "x", description: "" });
    const saved = await scope.run(saveDraft);
    expect(saved).toEqual({ title: "x", description: "" });
    expect(seen).toEqual(["post"]);
    expect(scope.resolve(draft)).toEqual({ title: "", description: "" });
  } finally {
    stop.abort();
    await scope.closed;
  }
});
