# 0006 Validate at the process edge once; trust types inside

Date: 2026-09-13. Status: accepted.

## Context

Re-checking typed values inside a program adds code, hides real trust
boundaries, and turns types into runtime walls.

## Decision

Data from outside the process (network, fs, env, argv, user input) is
validated once where it enters. After that, typed values are trusted. No
`typeof` walls, no defensive checks on typed parameters, no `as unknown as`.
`isX` narrows the smallest stable shape; `readX` does any real admission once.

## Consequences

Exported functions do not validate their arguments at runtime. Library users
get the types as the contract. Census S02 and S14 catch the common escapes.
