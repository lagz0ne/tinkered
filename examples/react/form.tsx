import { createScope, data, operation } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";

/** One draft cell: the whole form is one record, so one write replaces the draft. */
export type Draft = { readonly title: string; readonly description: string };

/** The draft one form edits. Cleared on a successful save. */
export const draft = data<Draft>({ label: "draft", initial: { title: "", description: "" } });

/** One field guard: the door for one patch field. */
type Field<V> = (value: unknown) => value is V;

/** A string field, or nothing. */
function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** True when a patch key names a guarded field. */
function isField<T>(
  key: string,
  fields: { [K in keyof T]-?: Field<T[K]> },
): key is keyof T & string {
  return key in fields;
}

/** Check one present patch field; absent stays absent, a failing guard raises. */
function setField<T, K extends keyof T & string>(
  patch: Partial<T>,
  key: K,
  guard: Field<T[K]>,
  value: unknown,
): void {
  if (value === undefined) return;
  if (!guard(value)) throw new Error(`${key} is unreadable`);
  patch[key] = value;
}

/** Admit a partial patch: for each key present on `raw` the guard must pass; absent keys stay
 * absent. Non-object input raises. */
function readPatch<T>(raw: unknown, fields: { [K in keyof T]-?: Field<T[K]> }): Partial<T> {
  if (typeof raw !== "object" || raw === null) throw new Error("patch is unreadable");
  const patch: Partial<T> = {};
  const seen: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) seen[key] = value;
  for (const key of Object.keys(fields)) {
    if (!isField(key, fields)) continue;
    setField(patch, key, fields[key], seen[key]);
  }
  return patch;
}

/** Type one form field at the door. */
export const typeDraft = operation({
  label: "typeDraft",
  input: (raw) => readPatch<Draft>(raw, { title: isString, description: isString }),
  depends: { form: draft.controller },
  run: ({ form }, { input }) => {
    form.update((prev) => ({ ...prev, ...input }));
  },
});

/** The edge a save crosses: posting the draft to the outside world. Rebound in tests. */
export const save = operation({
  label: "save",
  input: (raw): Draft => {
    if (typeof raw !== "object" || raw === null) throw new Error("draft is unreadable");
    const { title, description } = readPatch<Draft>(raw, {
      title: isString,
      description: isString,
    });
    if (title === undefined || description === undefined) throw new Error("draft is unreadable");
    return { title, description };
  },
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
