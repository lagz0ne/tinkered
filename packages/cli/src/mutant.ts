export declare namespace Mutant {
  /**
   * The one fault `tinker pins` puts in a test run, through `TINKER_MUTANT` (ADR 0173). Each
   * is at a fact the graph states: an exit, a write of a cell, a call of another op. `op` is the
   * label of the operation the fault is in.
   */
  type Fault =
    | { kind: "swap"; op: string; from: string; to: string; value: unknown }
    | { kind: "empty"; op: string; from: string }
    | { kind: "drop"; op: string; cell: string }
    | { kind: "fail"; op: string; callee: string };
}

/** The mark of an answer with no empty twin: an `empty` mutant of it would change nothing. */
export const none = Symbol("none");

/** A number, a string or a boolean's empty twin; any other value has `none`. */
function scalarOf(value: unknown) {
  if (typeof value === "number") return value === 0 ? 1 : 0;
  if (typeof value === "string") return value === "" ? "x" : "";
  return typeof value === "boolean" ? !value : none;
}

/** An object keeps its `kind`; each other field is its twin, or `null` when it has none. */
function fieldsOf(value: object) {
  const fields = Object.entries(value).filter(([key]) => key !== "kind");
  if (!fields.length) return none;

  const twin: Record<string, unknown> = "kind" in value ? { kind: value.kind } : {};
  for (const [key, field] of fields) {
    const empty = emptyOf(field);
    twin[key] = empty === none ? null : empty;
  }
  return twin;
}

/**
 * The empty twin of an answer (extreme mutation, as Descartes does it): a number is 0, or 1
 * when it was 0; a string is "", or "x" when it was ""; a boolean flips; a list is []; an
 * object keeps its `kind` and twins each other field. An empty list, an object with only a
 * `kind`, and any other value have `none`.
 */
export function emptyOf(value: unknown): unknown {
  if (Array.isArray(value)) return value.length ? [] : none;
  if (typeof value === "object" && value !== null) return fieldsOf(value);
  return scalarOf(value);
}
