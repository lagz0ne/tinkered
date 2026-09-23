import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { addTool, lendTool, loansOf, retireTool, returnLoan, undoLibrary } from "./model.ts";
import type { Loan, Tool } from "./model.ts";
import { errorKind } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The new-tool form text, exactly as typed. */
export type ToolDraft = { name: string; copies: string };

/** The lend form: the chosen tool id and the member text as typed. */
export type LendDraft = { toolId: string; member: string };

/** Which tool rows the Tools table shows. Filtering never deletes. */
export type ToolFilter = "All" | "Available" | "Retired";

/** How one tool reads on screen. */
export type ToolStatus = "Available" | "Out" | "Retired";

/** One Tools table row. */
export type ToolRow = { id: string; name: string; copies: number; out: number; status: ToolStatus };

/** One Loans table row. */
export type LoanRow = { id: string; toolName: string; member: string };

const emptyTool: ToolDraft = { name: "", copies: "" };

export const toolDraft: Data.Cell<ToolDraft> = data({ label: "toolDraft", initial: emptyTool });

export const lendDraft: Data.Cell<LendDraft> = data({
  label: "lendDraft",
  initial: { toolId: "", member: "" },
});

export const toolFilter: Data.Cell<ToolFilter> = data({ label: "toolFilter", initial: "All" });

export const notice: Data.Cell<Name | undefined> = data({ label: "notice", initial: undefined });

const statusOf = (tool: Tool, out: number): ToolStatus => {
  if (tool.retired) return "Retired";
  return out >= tool.copies ? "Out" : "Available";
};

/** Tools table rows for one filter, in saved tool order. */
export const toolRows = (
  saved: readonly Tool[],
  open: readonly Loan[],
  filter: ToolFilter,
): readonly ToolRow[] =>
  saved
    .map((tool) => {
      const out = loansOf(open, tool.id).length;
      return {
        id: tool.id,
        name: tool.name,
        copies: tool.copies,
        out,
        status: statusOf(tool, out),
      };
    })
    .filter((row) => filter === "All" || row.status === filter);

/** Loans table rows in saved loan order. */
export const loanRows = (saved: readonly Tool[], open: readonly Loan[]): readonly LoanRow[] =>
  open.flatMap((loan) =>
    saved
      .filter((tool) => tool.id === loan.toolId)
      .map((tool) => ({ id: loan.id, toolName: tool.name, member: loan.member })),
  );

const kindOf = (error: unknown): Name => {
  const kind = errorKind(error);
  if (kind === undefined) throw error;
  return kind;
};

/** Type into the Name input. Clears any earlier notice. */
export const typeName: Operation.Handle<void, { value: string }> = operation({
  label: "typeName",
  depends: { draft: toolDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, name: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Copies input. Clears any earlier notice. */
export const typeCopies: Operation.Handle<void, { value: string }> = operation({
  label: "typeCopies",
  depends: { draft: toolDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, copies: input.value }));
    shown.set(undefined);
  },
});

/** Choose a tool in the lend form. Clears any earlier notice. */
export const chooseTool: Operation.Handle<void, { toolId: string }> = operation({
  label: "chooseTool",
  depends: { draft: lendDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((lend) => ({ ...lend, toolId: input.toolId }));
    shown.set(undefined);
  },
});

/** Type into the Member input. Clears any earlier notice. */
export const typeMember: Operation.Handle<void, { value: string }> = operation({
  label: "typeMember",
  depends: { draft: lendDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((lend) => ({ ...lend, member: input.value }));
    shown.set(undefined);
  },
});

/** Show All, Available, or Retired tool rows. Clears any earlier notice. */
export const chooseFilter: Operation.Handle<void, ToolFilter> = operation({
  label: "chooseFilter",
  depends: { filter: toolFilter.controller, shown: notice.controller },
  run: ({ filter, shown }, { input }) => {
    filter.set(input);
    shown.set(undefined);
  },
});

/** Add the typed tool. Success clears both inputs; failure keeps them and shows the kind. */
export const submitTool: Operation.Handle<void, void> = operation({
  label: "submitTool",
  depends: { draft: toolDraft.controller, shown: notice.controller, add: addTool.controller },
  run: ({ draft, shown, add }) => {
    try {
      add.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.set(emptyTool);
    shown.set(undefined);
  },
});

/** Lend the chosen tool. The lend form keeps its text either way. */
export const submitLend: Operation.Handle<void, void> = operation({
  label: "submitLend",
  depends: { draft: lendDraft.controller, shown: notice.controller, lend: lendTool.controller },
  run: ({ draft, shown, lend }) => {
    try {
      lend.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Retire one tool from its row button. */
export const submitRetire: Operation.Handle<void, { toolId: string }> = operation({
  label: "submitRetire",
  depends: { shown: notice.controller, retire: retireTool.controller },
  run: ({ shown, retire }, { input }) => {
    try {
      retire.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Return one loan from its row button. */
export const submitReturn: Operation.Handle<void, { loanId: string }> = operation({
  label: "submitReturn",
  depends: { shown: notice.controller, giveBack: returnLoan.controller },
  run: ({ shown, giveBack }, { input }) => {
    try {
      giveBack.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Undo the last passing change. Form text, the chosen tool, and the filter stay. */
export const submitUndo: Operation.Handle<void, void> = operation({
  label: "submitUndo",
  depends: { shown: notice.controller, undo: undoLibrary.controller },
  run: ({ shown, undo }) => {
    try {
      undo.run({});
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});
