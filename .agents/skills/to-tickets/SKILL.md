---
name: to-tickets
description: Break a plan, spec, or the current talk into tracer-bullet tickets, each naming the tickets that block it, written into a track's PROGRESS.md and the TODO.md board.
disable-model-invocation: true
---

# To tickets

Break a plan, a spec, or the talk so far into **tickets**. Each ticket is a
tracer bullet: one thin slice that works end to end. Each one names the
tickets that **block** it.

## 1. Gather

Work from what the talk already holds. If the user passes a spec path or a
link, read all of it.

## 2. Read the code

If you have not read the code yet, read it now. Titles use the words in
`docs/glossary.md`. Tickets respect the decisions in `docs/decisions/` for the
area they touch.

Look for a prefactor: a small change first that makes the real change easy.
"Make the change easy, then make the easy change."

## 3. Draft vertical slices

- A slice cuts a narrow but **complete** path through every layer (types,
  API, UI, tests). Not one layer on its own.
- A finished slice can be shown or checked on its own.
- A slice fits one fresh agent session.
- Prefactors come first.

Give each ticket its **blockers**: the tickets that must finish before it
starts. A ticket with none can start now.

### Wide refactors

A **wide refactor** is one mechanical change (rename a field, retype a shared
symbol) whose **blast radius** spans the whole codebase. One edit breaks every
caller at once, so no thin slice can land green. Run it as
**expand, migrate, contract**:

1. **Expand:** add the new form beside the old. Nothing breaks.
2. **Migrate:** move callers over in batches, one package or folder each.
   Each batch is a ticket blocked by the expand. The old form still exists,
   so every batch stays green.
3. **Contract:** delete the old form once no caller is left. This ticket is
   blocked by every batch.

If even a batch cannot stay green alone, keep the order but share one branch.
A last ticket, blocked by all the batches, merges and checks. Only that one
promises green.

## 4. Ask the user

Show the plan as a numbered list. For each ticket:

- **Title:** a short name.
- **Blocked by:** the tickets that must finish first, or none.
- **Delivers:** the behavior this ticket makes work, end to end.

Then ask:

- Is the size right? Too big, too small?
- Is each blocker real? Does it truly gate the ticket?
- Should any ticket merge or split?

Repeat until the user approves.

## 5. Write the tickets down

1. **The track file.** Add each ticket under `## Tickets` in
   `docs/roadmap/<track>/PROGRESS.md`, blockers first. Create the track if
   it is new. Copy the shape of the tickets there:

   ```md
   - **t02 ns resource build** -- [ ] blocked by: t01
     What works when this lands, from the user's side.
     Verify: the command or test that proves it.
   ```

2. **The board.** Add one card per ticket to `## Ready` in `TODO.md`, in
   order. Each card has a stable name, a next step, a Verify line, and a link
   to the track.

Work the **frontier**: any ticket whose blockers are all done. A straight chain
runs top to bottom.

## Keep it durable

Leave out file paths and code: they go stale fast. One exception: when a
prototype made a snippet that states a decision more exactly than words can (a
state machine, a type shape), paste the part that holds the decision and say it
came from a prototype.
