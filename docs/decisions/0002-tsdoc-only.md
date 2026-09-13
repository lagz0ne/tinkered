# 0002 Comments are TSDoc on exports only

Date: 2026-09-13. Status: accepted.

## Context

Comments drift from code. tinker-engine allows TSDoc on public interfaces and
nothing else, so names and shapes must carry the meaning.

## Decision

`/** */` on exported interfaces and functions only. No line comments, no
block comments, no `@ts-ignore`, no lint-disable lines.

## Consequences

Census S10, S11, S12, S13 fail strict mode on any hit. When code needs a
comment to be understood, rename or reshape it instead.
