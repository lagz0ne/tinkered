/**
 * Each Tinker rule id `tinker check` prints. A skill teaches each one in a section with the id
 * in its heading, and the check prints that section's `Right:` part as the fix (ADR 0156
 * decision 8). `vp run skills` fails for an id with no section.
 */
export const rules = [
  "tinker/kind",
  "tinker/cast",
  "tinker/plain",
  "tinker/one-wire",
  "tinker/react-state",
  "tinker/keyed-prop",
  "tinker/gap",
  "tinker/floating",
  "tinker/cell-write",
] as const;
