# 0001 The coding convention covers TypeScript only

Date: 2026-09-13. Status: accepted.

## Context

The repo is a Vite+ TypeScript monorepo. tinker-engine's house style is
TypeScript-specific and its rules are sharp because of that.

## Decision

The `coding-convention` skill applies to `.ts` and `.tsx` source and tests
only. Prose, config, CSS, and HTML are out of scope.

## Consequences

Rules can name exact TypeScript shapes (`private`, overloads, `isX` guards)
and the census can grep for them. A second language would need its own skill.
