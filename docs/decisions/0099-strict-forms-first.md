# 0099 Strict forms first; plain functions are exceptions

Date: 2026-10-03. Status: accepted.

## Context

A review of the flight-trial services found 17 plain functions and one class.
Some took a clock, two stop signals, a whole state, or an operation handle.
Such a function hides work and ownership from the graph.

The user chose to start very strict and loosen later.
The primitives evolve from what the strict rule cannot express.

## Decision

Code is tags, data, resources, operations, and extensions.

A plain function is allowed only when all five hold:

1. It is pure: no IO, `await`, clock, random, signal, or closure state.
2. Its params are plain values.
   Never a Core handle, controller, `ctx`, clock, signal, or IO object.
3. It has at most three params, each the smallest piece needed.
4. It has at least two call sites; one caller means inline it.
5. Its TSDoc says, per param, where the value comes from and why.

No classes.

Every remaining plain function is listed with its params and call sites.
The list should only shrink.
A check script enforces points 2 to 4 and the class ban.

## Consequences

Some code repeats until Core can share a unit with a slot.
Each such case becomes a Core feedback row.
The Start scaffold ships the check and teaches the rule in its skills.
The flight trial's gate runs the same check on the writer's code.
