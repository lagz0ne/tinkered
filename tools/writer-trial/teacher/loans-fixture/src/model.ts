/**
 * Teacher-only tool library. Built from the frozen task and the public
 * core declarations only; never copied into a worker image or context.
 */
import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { fail } from "./errors.ts";

/** One tool in the library. */
export type Tool = { id: string; name: string; copies: number; retired: boolean };

/** One open loan of a tool to a member. */
export type Loan = { id: string; toolId: string; member: string };

type Library = { tools: readonly Tool[]; loans: readonly Loan[] };

/** Saved tools in creation order. */
export const tools: Data.Cell<readonly Tool[]> = data({ label: "tools", initial: [] });

/** Open loans in creation order. */
export const loans: Data.Cell<readonly Loan[]> = data({ label: "loans", initial: [] });

const history: Data.Cell<readonly Library[]> = data({ label: "history", initial: [] });

const issued: Data.Cell<number> = data({ label: "issued", initial: 0 });

const MEMBER_LIMIT = 3;
const PLAIN_DIGITS = /^[0-9]+$/;

const libraryCells = {
  tools: tools.controller,
  loans: loans.controller,
  history: history.controller,
  issued: issued.controller,
};

function readName(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw fail("BlankName", { name: raw });
  return raw.trim();
}

function readMember(raw: unknown): string {
  if (typeof raw !== "string" || raw.trim() === "") throw fail("BlankMember", { member: raw });
  return raw.trim();
}

function readCopies(raw: unknown): number {
  if (typeof raw !== "string" || !PLAIN_DIGITS.test(raw.trim()))
    throw fail("BadCopies", { copies: raw });
  const copies = Number(raw.trim());
  if (copies < 1 || copies > 20) throw fail("BadCopies", { copies: raw });
  return copies;
}

const findTool = (rows: readonly Tool[], id: string): Tool => {
  const tool = rows.find((row) => row.id === id);
  if (tool === undefined) throw fail("NotFound", { id });
  return tool;
};

const replaceTool = (rows: readonly Tool[], changed: Tool): readonly Tool[] =>
  rows.map((row) => (row.id === changed.id ? changed : row));

/** The open loans of one tool, in saved loan order. */
export const loansOf = (rows: readonly Loan[], toolId: string): readonly Loan[] =>
  rows.filter((loan) => loan.toolId === toolId);

/** Add a tool with a trimmed name and parsed copies. */
export const addTool: Operation.Handle<Tool, { name: string; copies: string }> = operation({
  label: "addTool",
  depends: libraryCells,
  run: (cells, { input }) => {
    const name = readName(input.name);
    const copies = readCopies(input.copies);
    const next = cells.issued.get() + 1;
    cells.issued.set(next);
    const saved: Tool = { id: `tool-${next}`, name, copies, retired: false };
    const step = { tools: cells.tools.get(), loans: cells.loans.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.tools.set([...cells.tools.get(), saved]);
    return saved;
  },
});

/** Change one tool's copies; the same value passes with no change. */
export const setCopies: Operation.Handle<Tool, { toolId: string; copies: string }> = operation({
  label: "setCopies",
  depends: libraryCells,
  run: (cells, { input }) => {
    const copies = readCopies(input.copies);
    const tool = findTool(cells.tools.get(), input.toolId);
    if (tool.copies === copies) return tool;
    if (tool.retired) throw fail("Retired", { id: tool.id });
    const onLoan = loansOf(cells.loans.get(), tool.id).length;
    if (copies < onLoan) throw fail("BelowLoans", { id: tool.id, onLoan });
    const changed: Tool = { ...tool, copies };
    const step = { tools: cells.tools.get(), loans: cells.loans.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.tools.set(replaceTool(cells.tools.get(), changed));
    return changed;
  },
});

/** Retire a tool with no open loans; a retired tool passes with no change. */
export const retireTool: Operation.Handle<Tool, { toolId: string }> = operation({
  label: "retireTool",
  depends: libraryCells,
  run: (cells, { input }) => {
    const tool = findTool(cells.tools.get(), input.toolId);
    if (tool.retired) return tool;
    const loanIds = loansOf(cells.loans.get(), tool.id).map((loan) => loan.id);
    if (loanIds.length > 0) throw fail("OnLoan", { id: tool.id, loanIds });
    const changed: Tool = { ...tool, retired: true };
    const step = { tools: cells.tools.get(), loans: cells.loans.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.tools.set(replaceTool(cells.tools.get(), changed));
    return changed;
  },
});

/** Lend a tool to a member; a loan the member already holds passes unchanged. */
export const lendTool: Operation.Handle<Loan, { toolId: string; member: string }> = operation({
  label: "lendTool",
  depends: libraryCells,
  run: (cells, { input }) => {
    const member = readMember(input.member);
    const tool = findTool(cells.tools.get(), input.toolId);
    const rows = cells.loans.get();
    const held = rows.find((loan) => loan.toolId === tool.id && loan.member === member);
    if (held !== undefined) return held;
    if (tool.retired) throw fail("Retired", { id: tool.id });
    if (loansOf(rows, tool.id).length >= tool.copies) throw fail("NoCopyLeft", { id: tool.id });
    if (rows.filter((loan) => loan.member === member).length >= MEMBER_LIMIT)
      throw fail("MemberLimit", { member });
    const next = cells.issued.get() + 1;
    cells.issued.set(next);
    const loan: Loan = { id: `loan-${next}`, toolId: tool.id, member };
    const step = { tools: cells.tools.get(), loans: cells.loans.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.loans.set([...rows, loan]);
    return loan;
  },
});

/** Return one open loan. */
export const returnLoan: Operation.Handle<void, { loanId: string }> = operation({
  label: "returnLoan",
  depends: libraryCells,
  run: (cells, { input }) => {
    const rows = cells.loans.get();
    if (!rows.some((loan) => loan.id === input.loanId))
      throw fail("NotFound", { id: input.loanId });
    const step = { tools: cells.tools.get(), loans: cells.loans.get() };
    cells.history.update((steps) => [...steps, step]);
    cells.loans.set(rows.filter((loan) => loan.id !== input.loanId));
  },
});

/** Restore the exact tools and loans before the last passing change. */
export const undoLibrary: Operation.Handle<void, void> = operation({
  label: "undoLibrary",
  depends: { tools: tools.controller, loans: loans.controller, history: history.controller },
  run: (cells) => {
    const steps = cells.history.get();
    const last = steps.at(-1);
    if (last === undefined) throw fail("EmptyUndo", {});
    cells.tools.set(last.tools);
    cells.loans.set(last.loans);
    cells.history.set(steps.slice(0, -1));
  },
});
