import { createScope, data, operation } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { z } from "zod";

/** One draft cell: the whole form is one record, so one write replaces the draft. */
export type Draft = { readonly title: string; readonly description: string };

/** The draft one form edits. Cleared on a successful save. */
export const draft = data<Draft>({ label: "draft", initial: { title: "", description: "" } });

/** The two fields, each optional: a patch touches one at a time. */
const patchSchema = z.object({ title: z.string().optional(), description: z.string().optional() });

/** Type one form field at the door. */
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

/** Save the draft through the `save` edge, then clear the cell. */
export const saveDraft = operation({
  label: "saveDraft",
  depends: { post: save, form: draft.controller },
  run: async ({ post, form }) => {
    const saved = await post.run({ input: form.get() });
    form.set({ title: "", description: "" });
    return saved;
  },
});

/** A two-field form on `@tinker/react`: the draft is ONE `data` cell, typing is one
 * `typeDraft`, saving is one `saveDraft`. The component only reads (`useData`) and runs
 * (`useRun`) — no `useState`, no `useEffect`. */
export function DraftForm(): React.ReactElement {
  const current = useData(draft);
  const type = useRun(typeDraft);
  const saveRun = useRun(saveDraft);
  return (
    <form>
      <input
        aria-label="title"
        value={current.title}
        onChange={(event) => type.run({ input: { title: event.target.value } })}
      />
      <input
        aria-label="description"
        value={current.description}
        onChange={(event) => type.run({ input: { description: event.target.value } })}
      />
      <button type="button" onClick={() => saveRun.run()}>
        {saveRun.status === "success" ? "saved" : "save"}
      </button>
    </form>
  );
}

/** The composition root: one scope, handed to the provider. */
export function App(): React.ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <DraftForm />
    </ScopeProvider>
  );
}
