import { expect, test } from "vite-plus/test";
import { createScope, preset } from "@tinker/core";
import { draft, save, saveDraft, typeDraft } from "./form.js";

test("typing then saving posts once and clears the draft", async () => {
  const seen: string[] = [];
  const scope = createScope({
    presets: [
      preset(save, (_deps, ctx) => {
        seen.push("post");
        return Promise.resolve(ctx.input);
      }),
    ],
  });
  try {
    scope.run(typeDraft, { input: { title: "x" } });
    expect(scope.resolve(draft)).toEqual({ title: "x", description: "" });
    const saved = await scope.run(saveDraft);
    expect(saved).toEqual({ title: "x", description: "" });
    expect(seen).toEqual(["post"]);
    expect(scope.resolve(draft)).toEqual({ title: "", description: "" });
  } finally {
    await scope.close();
  }
});
