import { capsule, createScope, data, operation, tag, type Operation } from "@tinkered/core";
import { ScopeProvider, useData, useRun } from "@tinkered/react";
import { z } from "zod";

const draftSchema = z.object({ title: z.string(), description: z.string() });

export type Draft = z.infer<typeof draftSchema>;

/** The draft one form edits. Cleared on a successful save. */
const draft = data<Draft>({ label: "drafts.draft", initial: { title: "", description: "" } });

/** The two fields, each optional: a patch touches one at a time. */
const patchSchema = z.object({ title: z.string().optional(), description: z.string().optional() });

const typeDraft = operation({
  label: "drafts.type",
  input: patchSchema,
  depends: { form: draft.controller },
  run: ({ form }, { input }) => {
    form.update((prev) => ({ ...prev, ...input }));
  },
});

/** The slot: the edge a save crosses, posting the draft to the outside world. The cmd fills it. */
const post = tag<Operation.Handle<Promise<Draft>, Draft>>({ label: "drafts.post" });

/** Clears the draft only after the post resolves: a failed post keeps the typed text. */
const saveDraft = operation({
  label: "drafts.save",
  depends: { post, form: draft.controller },
  run: async ({ post, form }) => {
    const saved = await post.run({ input: form.get() });
    form.set({ title: "", description: "" });
    return saved;
  },
});

/** The form reads its own capsule's units; others reach them through the install. */
function DraftForm(): React.ReactElement {
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

/** A draft form with its post in a slot: `drafts({ post: local.keep })`. */
export const drafts = capsule({
  label: "drafts",
  config: { post: post.required },
  exports: { draft, typeDraft, saveDraft, DraftForm },
});

/** A post that keeps the draft in this browser and answers it back. */
const keep = operation({
  label: "drafts.local.keep",
  input: draftSchema,
  run: (_deps, { input }) => Promise.resolve(input),
});

/** The local backend for the post slot. */
export const localPost = capsule({ label: "drafts.local", exports: { keep } });

const local = localPost();
const form = drafts({ post: local.keep });

export function App(): React.ReactElement {
  return (
    <ScopeProvider create={() => createScope({ capsules: [local, form] })}>
      <form.DraftForm />
    </ScopeProvider>
  );
}
