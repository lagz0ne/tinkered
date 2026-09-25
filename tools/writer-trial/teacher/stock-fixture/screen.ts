import { data, operation } from "@tinker/core";
import type { Data, Operation, Scope } from "@tinker/core";
import { discardMoveEdit, moveStock, openMoveEdit, saveMoveEdit } from "./model.ts";
import { errorKind, fail } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The move form text, exactly as typed. Quantity stays text until submit. */
export type FormText = { item: string; from: string; to: string; quantity: string };

/** The edit draft text, exactly as typed, for the drafted move id. */
export type EditText = { id: string; item: string; from: string; to: string; quantity: string };

export type ListFilter = "All" | "Cable" | "Stand";

export const bookingForm: Data.Cell<FormText> = data({
  label: "bookingForm",
  initial: { item: "Cable", from: "East", to: "West", quantity: "1" },
});

export const editFormText: Data.Cell<EditText | undefined> = data({
  label: "editFormText",
  initial: undefined,
});

export const listFilter: Data.Cell<ListFilter> = data({
  label: "listFilter",
  initial: "All",
});

export const notice: Data.Cell<Name | undefined> = data({
  label: "notice",
  initial: undefined,
});

/** Run one body, showing the first managed error's kind and rethrowing. */
const withNotice = <R>(body: () => R, cell: Scope.DataController<Name | undefined>): R => {
  try {
    return body();
  } catch (error) {
    const kind = errorKind(error);
    if (kind === undefined) throw error;
    cell.set(kind);
    throw error;
  }
};

const withText = <F extends string, T extends Readonly<Record<F, string>>>(
  record: T,
  field: F,
  value: string,
): T => ({ ...record, [field]: value });

/** Quantity parses at the input boundary: cleared or unreadable text keeps
 * its text in the BadQuantity payload. */
const quantityOf = (raw: string): number => {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) throw fail("BadQuantity", { quantity: raw });
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value) || value <= 0) throw fail("BadQuantity", { quantity: raw });
  return value;
};

/** Type into the move form. */
export const chooseFormField: Operation.Handle<void, { field: keyof FormText; value: string }> =
  operation({
    label: "chooseFormField",
    depends: { form: bookingForm.controller },
    run: ({ form }, ctx) => {
      form.set(withText(form.get(), ctx.input.field, ctx.input.value));
    },
  });

/** Type into the edit draft. */
export const typeEditField: Operation.Handle<
  void,
  { field: Exclude<keyof EditText, "id">; value: string }
> = operation({
  label: "typeEditField",
  depends: { edit: editFormText.controller },
  run: ({ edit }, ctx) => {
    const current = edit.get();
    if (current === undefined) return;
    edit.set(withText(current, ctx.input.field, ctx.input.value));
  },
});

/** Show one item, or every move. Filtering never deletes. */
export const chooseFilter: Operation.Handle<void, ListFilter> = operation({
  label: "chooseFilter",
  depends: { filter: listFilter.controller },
  run: ({ filter }, ctx) => {
    filter.set(ctx.input);
  },
});

/** Submit the form. Success keeps values; failure keeps them too. */
export const submitMove: Operation.Handle<void, void> = operation({
  label: "submitMove",
  depends: {
    form: bookingForm.controller,
    noticeCell: notice.controller,
    move: moveStock.controller,
  },
  run: ({ form, noticeCell, move }) =>
    withNotice(() => {
      const text = form.get();
      move.run({
        input: {
          item: text.item,
          from: text.from,
          to: text.to,
          quantity: quantityOf(text.quantity),
        },
      });
      noticeCell.set(undefined);
    }, noticeCell),
});

/** Open a move for edit and seed the editor text from the saved row.
 * Switching rows replaces all input text. */
export const openEditor: Operation.Handle<void, { id: string }> = operation({
  label: "openEditor",
  depends: {
    edit: editFormText.controller,
    open: openMoveEdit.controller,
    noticeCell: notice.controller,
  },
  run: ({ edit, open, noticeCell }, ctx) =>
    withNotice(() => {
      const saved = open.run({ input: { id: ctx.input.id } });
      edit.set({
        id: saved.id,
        item: saved.item,
        from: saved.from,
        to: saved.to,
        quantity: String(saved.quantity),
      });
      noticeCell.set(undefined);
    }, noticeCell),
});

/** Save the typed edit. Failure keeps the typed text. */
export const submitEditSave: Operation.Handle<void, void> = operation({
  label: "submitEditSave",
  depends: {
    edit: editFormText.controller,
    noticeCell: notice.controller,
    save: saveMoveEdit.controller,
  },
  run: ({ edit, noticeCell, save }) =>
    withNotice(() => {
      const text = edit.get();
      if (text === undefined) throw fail("NotFound", { id: "closed" });
      save.run({
        input: {
          id: text.id,
          item: text.item,
          from: text.from,
          to: text.to,
          quantity: quantityOf(text.quantity),
        },
      });
      edit.set(undefined);
      noticeCell.set(undefined);
    }, noticeCell),
});

/** Discard the typed edit. */
export const submitEditDiscard: Operation.Handle<void, { id: string }> = operation({
  label: "submitEditDiscard",
  depends: {
    edit: editFormText.controller,
    noticeCell: notice.controller,
    discard: discardMoveEdit.controller,
  },
  run: ({ edit, noticeCell, discard }, ctx) =>
    withNotice(() => {
      discard.run({ input: { id: ctx.input.id } });
      edit.set(undefined);
      noticeCell.set(undefined);
    }, noticeCell),
});
