# 0007 Style is enforced by our own grep census, not a copied one

Date: 2026-09-13. Status: accepted.

## Context

tinker-engine ships `style-census.sh`. Its intentions fit here; its exact
pattern list is tied to that engine's rulings (frozen constants, `TypeError`
for untyped data, `~name` internals).

## Decision

`.agents/skills/coding-convention/scripts/style-census.sh` is written for this
repo. Same spirit, own list: source checks (S*), test checks (T*), and watch
counts (W*). Strict mode fails on any S* or T* hit. W* are reported only.
`vp check` and `vp test` run first; the census runs last; the handoff ends
with the line `Style census: OK`.

## Consequences

The pattern list grows here, by decision, as slips are found. A later move to
a real oxlint plugin is allowed and would replace the grep for the same ids.
