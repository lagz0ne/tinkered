import type { Check } from "./check";
import { unseen } from "./graph";
import type { Graph } from "./graph";
import type { Tools } from "./tools";

/** `*` stands for one label part or more: `issues.*` holds `issues.archived`, not `issues`. */
function matches([head, ...rest]: readonly string[], parts: readonly string[]): boolean {
  if (head === undefined) return !parts.length;
  if (head !== "*") return parts[0] === head && matches(rest, parts.slice(1));
  return parts.some((_, index) => matches(rest, parts.slice(index + 1)));
}

/**
 * The cell a write names, by its parts. A pattern names a cell, so the method is no part of
 * the match: `issues.list` holds `issues.list.set` and `issues.list.delete`.
 */
const cellOf = (write: string) => write.slice(0, write.lastIndexOf(".")).split(".");

/**
 * Each op `start` reaches through its calls, and theirs in turn: not `start` itself, unless a
 * call leads back to it. `blind` is each op on the way whose calls have a `?`: an op there may
 * be called, unseen. Calls are sorted, so the order of `blind` is the same on each run.
 */
function reach(start: Graph.Line, byLabel: ReadonlyMap<string, Graph.Line>) {
  const reached = new Set<string>();
  const blind = new Set<string>();
  const queue = [start];
  for (const { label, calls } of queue) {
    if (calls.includes(unseen)) blind.add(label);
    for (const callee of calls) {
      const next = byLabel.get(callee);
      if (next && !reached.has(callee)) queue.push(next);
      reached.add(callee);
    }
  }
  return { reached, blind: [...blind] };
}

/** What `line` breaks of `rule`, if it breaks it: the rule's op and its `except` ops are exempt. */
function broken(
  { writes, calls, except = {} }: Check.GraphRule,
  line: Graph.Line,
  byLabel: ReadonlyMap<string, Graph.Line>,
) {
  if (line.label === calls || Object.hasOwn(except, line.label)) return undefined;
  const pattern = writes.split(".");
  const matched = line.writes.filter(
    (write) => write !== unseen && matches(pattern, cellOf(write)),
  );
  if (!matched.length) return undefined;

  const { reached, blind } = reach(line, byLabel);
  if (reached.has(calls)) return undefined;

  const head = `${line.label} writes{${matched.join(",")}}`;
  return blind.length
    ? `${head}, calls{?} in ${blind.join(", ")} cannot prove ${calls}`
    : `${head}, calls has no ${calls}`;
}

/**
 * A `tinker/graph-rule` finding for each operation that breaks a rule of the app's (ADR 0167),
 * at the operation. A `?` on the way is a finding too: the rule cannot be proved. No rule, no
 * finding: the check finds no copy by itself.
 */
export function ruleFindings(
  lines: readonly Graph.Line[],
  rules: readonly Check.GraphRule[],
): Tools.Found[] {
  const byLabel = new Map(lines.map((line) => [line.label, line]));
  return rules.flatMap((rule) =>
    lines.flatMap((op): Tools.Found[] => {
      const what = broken(rule, op, byLabel);
      return what ? [{ path: op.path, line: op.line, rule: "tinker/graph-rule", what }] : [];
    }),
  );
}
