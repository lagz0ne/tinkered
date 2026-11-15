/** A lint rule's setting, in the shape the app's lint config takes. */
type Setting = "error" | ["error", Readonly<Record<string, boolean | string>>];

/**
 * Tinker's gates (ADR 0156 decisions 5 and 6), for the app's lint `overrides`. The app places
 * them on the files they guard, such as `src/**`.
 *
 * - The kind gate: a `switch` on a call's answer has a case for each kind, and no `default`.
 *   A `default` does not stand in for a kind, so a new kind still fails.
 * - The cast gate: no `as` but `as const`, no `!`, no `any`.
 */
export const gates: Readonly<Record<string, Setting>> = {
  "typescript/switch-exhaustiveness-check": [
    "error",
    { considerDefaultExhaustiveForUnions: false, allowDefaultCaseForExhaustiveSwitch: false },
  ],
  "typescript/consistent-type-assertions": ["error", { assertionStyle: "never" }],
  "typescript/no-non-null-assertion": "error",
  "typescript/no-explicit-any": "error",
};
