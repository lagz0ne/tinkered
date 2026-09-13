# 0005 Class internals use `private`, never `#private`

Date: 2026-09-13. Status: accepted.

## Context

tinker-engine exposes internals as `"~name"()` methods so extensions can reach
them. This repo has no extension model yet.

## Decision

Use the TypeScript `private` keyword. Never `#private`, no `Reflect.*`, no
nested classes. No `~name` convention.

## Consequences

Simpler classes. If a reachable-internals need appears later, a new decision
introduces it. Census S01 and S08 enforce this.
