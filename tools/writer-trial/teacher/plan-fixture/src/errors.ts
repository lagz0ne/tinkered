type Payloads = {
  BlankTitle: { title: unknown };
  NotFound: { id: string };
  SelfRequirement: { id: string };
  Cycle: { courseId: string; prerequisiteId: string };
  CourseDone: { id: string };
  NotRequired: { courseId: string; prerequisiteId: string };
  PrerequisitesOpen: { id: string; prerequisiteIds: readonly string[] };
  DependentsDone: { id: string; dependentIds: readonly string[] };
  EmptyUndo: Record<string, never>;
};

export type Errors = {
  readonly Name: keyof Payloads;
  readonly Payload: Payloads;
  readonly Of: Of;
};

export type Name = keyof Payloads;

export type Of<N extends Name = Name> = Error & {
  readonly kind: N;
  readonly payload: Payloads[N];
};

/** The single place a registry error is made. */
export function fail<const N extends Name>(kind: N, payload: Payloads[N]): Of<N> {
  const error = new Error(`${kind}: ${JSON.stringify(payload)}`);
  return Object.assign(error, { kind, payload });
}

/** Narrow an unknown thrown value to one registry entry. */
export function isError<const N extends Name>(value: unknown, kind: N): value is Of<N> {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    "payload" in value &&
    value.kind === kind
  );
}

/** Every kind, in registry order. */
const kinds: readonly Name[] = [
  "BlankTitle",
  "NotFound",
  "SelfRequirement",
  "Cycle",
  "CourseDone",
  "NotRequired",
  "PrerequisitesOpen",
  "DependentsDone",
  "EmptyUndo",
];

/** The kind of a registry error, for display; undefined when not ours. */
export function errorKind(value: unknown): Name | undefined {
  for (const kind of kinds) {
    if (isError(value, kind)) return kind;
  }
  return undefined;
}
