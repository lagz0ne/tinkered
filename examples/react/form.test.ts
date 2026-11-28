import { capsule, createScope, operation } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { drafts, type Draft } from "./form";

test("typing then saving posts once and clears the draft", async () => {
  const seen: Draft[] = [];
  const record = operation({
    label: "test.post",
    run: (_deps, { input }: { input: Draft }) => {
      seen.push(input);
      return Promise.resolve(input);
    },
  });
  const fake = capsule({ label: "test.post", exports: { record } })();
  const form = drafts({ post: fake.record });
  const scope = await createScope({ capsules: [fake, form] }).ready;

  await scope.run(form.typeDraft, { input: { title: "x" } });
  expect(scope.resolve(form.draft).get()).toEqual({ title: "x", description: "" });

  const saved = await scope.run(form.saveDraft);
  expect(saved).toEqual({ title: "x", description: "" });

  expect(seen).toEqual([{ title: "x", description: "" }]);
  expect(scope.resolve(form.draft).get()).toEqual({ title: "", description: "" });
  await scope.close();
});
