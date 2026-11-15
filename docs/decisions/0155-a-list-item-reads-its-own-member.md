# 0155 A list item reads its own member

Date: 2026-11-15. Status: accepted (Duke, 11:01,
picked "B. Skill + analyze rule").
Keeps: ADR 0145 (one analyze command), ADR 0136
(keyed data, `of` and `where`).

## What the user said

- Duke, 2026-11-15 08:36: cheaper models (Sonnet,
  DeepSeek) should write golden code: one way to
  solve the frontend and the backend.
- Duke, 10:38: when the writers agree against
  golden, golden changes.
- Duke, 11:01: teach the per-card read with skill
  text and an analyze rule.

## Context

The CUJ eval (rung A, the issue board) ran 3
Sonnet and 3 DeepSeek writers. Each one passed
the card's member down from the list:

```tsx
{list.map((i) => <Card issue={i} />)}
```

The template passes the key. The card reads its
own member:

```tsx
{list.map((i) => <Card id={i.id} />)}
const issue = useData(part.of({ teamId, id }));
```

- A move then draws that one card.
- The React skill showed `.of()`, with no rule
  for when to use it.
- 6 of 6 runs missed it. Text alone did not
  reach them.

Precedent: React's own advice on lists. A row
that subscribes to its own record re-renders
alone (Redux "normalize and select by id",
TanStack Query `select` per row).

## Decision

1. Rule `tinker/keyed-prop` in
   `@tinkered/analyze`, on page files.
2. A finding is a JSX prop, or a spread, that
   hands down:
   - a list read with `useData(x.where(...))`;
   - one member of it, from `.map` and its kin
     (`flatMap`, `filter`, `find`, ...), through
     `filter`, `sort`, `toSorted`, `[...list]`.
3. A field (`id={i.id}`) and `key` pass.
4. Names resolve by scope: two callbacks that both
   say `issue` are apart.
5. Syntax only. A list passed through a prop,
   then mapped in the child, is found where it is
   first passed.
6. The React skill states the rule, with the right
   and the wrong form.

## Consequences

- All 6 eval runs get 1 finding; the template
  gets 0.
- Hedl has 1 finding
  (`src/frontend/tasks/views.tsx:248`). It shows
  when Hedl moves to this release.
- An app that needs the member as a prop puts the
  file in `page.skip` with its reason.
