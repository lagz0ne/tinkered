/** Tinker's own rules: `check` finds them in the app's files. */
export const own = [
  "tinker/plain",
  "tinker/one-wire",
  "tinker/react-state",
  "tinker/gap",
  "tinker/barrel",
] as const;

/** A lint rule that is a gate, by its lint code: its Tinker rule id. It belongs to `types`. */
export const gates: Readonly<Record<string, string>> = {
  "typescript(switch-exhaustiveness-check)": "tinker/kind",
  "typescript(consistent-type-assertions)": "tinker/cast",
  "typescript(no-non-null-assertion)": "tinker/cast",
  "typescript(no-explicit-any)": "tinker/cast",
};

/** A lint rule a skill teaches under a Tinker rule id. It belongs to `rules`. */
export const taught: Readonly<Record<string, string>> = {
  "typescript(no-floating-promises)": "tinker/floating",
  "tinker(cell-write)": "tinker/cell-write",
};

/**
 * Each Tinker rule id `tinker check` prints. A skill teaches each one in a section with the id
 * in its heading, and the check prints that section's `Right:` part as the fix (ADR 0156
 * decision 8). `vp run skills` fails for an id with no section.
 */
export const rules = [
  ...new Set([...own, ...Object.values(gates), ...Object.values(taught), "tinker/exit"]),
];
