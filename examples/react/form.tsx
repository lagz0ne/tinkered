import { createScope, data, operation } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { z } from "zod";

/** The draft one form edits. Cleared on a successful save. */
export const draft = data({ label: "draft", initial: { title: "", description: "" } });

/** The two fields, each optional: a patch touches one at a time. */
const patchSchema = z.object({ title: z.string().optional(), description: z.string().optional() });

export const typeDraft = operation({
  label: "typeDraft",
  input: patchSchema,
  depends: { form: draft.controller },
  run: ({ form }, { input }) => {
    form.update((prev) => ({ ...prev, ...input }));
  },
});

/** The edge a save crosses: posting the draft to the outside world. Rebound in tests. */
export const save = operation({
  label: "save",
  input: z.object({ title: z.string(), description: z.string() }),
  run: (_deps, { input }) => Promise.resolve(input),
});

/** Clears the draft only after `save` resolves: a failed post keeps the typed text. */
export const saveDraft = operation({
  label: "saveDraft",
  depends: { post: save, form: draft.controller },
  run: async ({ post, form }) => {
    const saved = await post.run({ input: form.get() });
    form.set({ title: "", description: "" });
    return saved;
  },
});

/** The public operations let the form test use the same graph without a DOM. */
export function DraftForm(): React.ReactElement {
  const current = useData(draft);
  const type = useRun(typeDraft);
  const saveRun = useRun(saveDraft);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        saveRun.run();
      }}
    >
      <label>
        Title
        <input
          value={current.title}
          onChange={(event) => type.run({ input: { title: event.target.value } })}
        />
      </label>
      <label>
        Description
        <input
          value={current.description}
          onChange={(event) => type.run({ input: { description: event.target.value } })}
        />
      </label>
      <button type="submit">{saveRun.status === "success" ? "saved" : "save"}</button>
    </form>
  );
}

export function App(): React.ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <DraftForm />
    </ScopeProvider>
  );
}
