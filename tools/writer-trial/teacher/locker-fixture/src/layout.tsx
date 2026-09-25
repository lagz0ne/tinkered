/**
 * Teacher layout kit. Every reference app draws its fields, named tables, row buttons, and
 * alert through these components, so one setting (layout-choice.ts) builds the same app in
 * several valid layouts. A checker must pass every layout: the tasks name fields, tables,
 * buttons, and the alert, not where they sit or how they are labeled.
 * Copied byte-for-byte into each fixture's src/ (kit-sync test).
 */
import { Children, cloneElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { LAYOUT_NAME } from "./layout-choice.ts";

/**
 * One layout: how labels, table names, row buttons, row headers, columns, and the alert look,
 * and whether the page shows its parts in task order or reversed, each in its own section.
 */
export type Layout = {
  readonly label: "wrap" | "for" | "aria";
  readonly tableName: "caption" | "aria";
  readonly actions: "column" | "first" | "last";
  readonly rowHeader: boolean;
  readonly reversed: boolean;
  readonly alert: "conditional" | "always";
  readonly parts: "task" | "reversed";
};

/** Five layouts; every value of every dimension appears at least once. */
export const LAYOUTS: Readonly<Record<string, Layout>> = {
  baseline: {
    label: "wrap",
    tableName: "caption",
    actions: "column",
    rowHeader: false,
    reversed: false,
    alert: "conditional",
    parts: "task",
  },
  L1: {
    label: "for",
    tableName: "aria",
    actions: "last",
    rowHeader: false,
    reversed: false,
    alert: "always",
    parts: "reversed",
  },
  L2: {
    label: "aria",
    tableName: "caption",
    actions: "first",
    rowHeader: true,
    reversed: true,
    alert: "conditional",
    parts: "task",
  },
  L3: {
    label: "wrap",
    tableName: "aria",
    actions: "first",
    rowHeader: false,
    reversed: true,
    alert: "always",
    parts: "task",
  },
  L4: {
    label: "for",
    tableName: "caption",
    actions: "last",
    rowHeader: true,
    reversed: false,
    alert: "conditional",
    parts: "reversed",
  },
};

const layout: Layout = LAYOUTS[LAYOUT_NAME] ?? LAYOUTS.baseline;

/** The props the kit sets on a control: its id (label for-id) or its aria-label. */
type ControlProps = { readonly id?: string; readonly "aria-label"?: string };

/** A labeled control. `for` ids are fresh per render, so two mounted apps never share one. */
export function Field(props: {
  readonly name: string;
  readonly control: ReactElement<ControlProps>;
}): ReactElement {
  const { name, control } = props;
  if (layout.label === "aria")
    return (
      <span>
        <span>{name}</span>
        {cloneElement(control, { "aria-label": name })}
      </span>
    );
  if (layout.label === "for") {
    const id = `field-${crypto.randomUUID()}`;
    return (
      <span>
        <label htmlFor={id}>{name}</label>
        {cloneElement(control, { id })}
      </span>
    );
  }
  return (
    <label>
      {name}
      {control}
    </label>
  );
}

/** One table row: its cells in task column order, and its buttons (none is fine). */
export type TableRow = {
  readonly key: string;
  readonly cells: readonly ReactNode[];
  readonly actions?: ReactNode;
};

const ordered = <T,>(items: readonly T[]): readonly T[] =>
  layout.reversed ? [...items].reverse() : items;

/** Place a row's buttons inside its first or last shown cell, or in their own column. */
function rowCells(row: TableRow): readonly ReactNode[] {
  const cells = ordered(row.cells);
  if (layout.actions === "column" || row.actions === undefined) return cells;
  const at = layout.actions === "first" ? 0 : cells.length - 1;
  return cells.map((cell, i) =>
    i === at ? (
      <>
        {cell}
        {row.actions}
      </>
    ) : (
      cell
    ),
  );
}

/** A table named `name`, with `headers` in task order and one row per `rows` item. */
export function NamedTable(props: {
  readonly name: string;
  readonly headers: readonly string[];
  readonly rows: readonly TableRow[];
}): ReactElement {
  const { name, headers, rows } = props;
  const actionsColumn = layout.actions === "column";
  return (
    <table aria-label={layout.tableName === "aria" ? name : undefined}>
      {layout.tableName === "caption" ? <caption>{name}</caption> : null}
      <thead>
        <tr>
          {ordered(headers).map((h) => (
            <th key={h} scope="col">
              {h}
            </th>
          ))}
          {actionsColumn ? <th scope="col">Actions</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.key}>
            {rowCells(row).map((cell, i) =>
              i === 0 && layout.rowHeader ? (
                <th key={i} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={i}>{cell}</td>
              ),
            )}
            {actionsColumn ? <td>{row.actions ?? null}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The one shared alert block: shown only with text, or always present and empty. */
export function Notice(props: { readonly text: string | null | undefined }): ReactElement | null {
  const { text } = props;
  if (layout.alert === "always") return <div role="alert">{text ?? ""}</div>;
  return text ? <p role="alert">{text}</p> : null;
}

/** The page: its parts in task order, or reversed with each part in its own section. */
export function Page(props: { readonly children: ReactNode }): ReactElement {
  const { children } = props;
  const parts = Children.toArray(children);
  if (layout.parts === "task") return <main>{parts}</main>;
  return (
    <div>
      {[...parts].reverse().map((part, i) => (
        <section key={i}>{part}</section>
      ))}
    </div>
  );
}
