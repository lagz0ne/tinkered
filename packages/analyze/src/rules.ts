import type { Check } from "./check";

/**
 * Each rule the analyzer checks, by its id (ADR 0143 decision 4). `fix` is the next step in a
 * few words; `skill` is the package skill that teaches the rule, as `intent load` names it.
 */
export const rules: Readonly<Record<Check.Rule, { fix: string; skill: string }>> = {
  "tinker/plain": {
    fix: "make it an operation",
    skill: "@tinkered/core#core/operation",
  },
  "tinker/one-wire": {
    fix: "call the server through the rpc client",
    skill: "@tinkered/core#core/rpc",
  },
  "tinker/react-state": {
    fix: "hold the state in a Core cell and read it with @tinkered/react",
    skill: "@tinkered/react#react",
  },
};
