# Decision format

Decisions live in `docs/decisions/` as `NNNN-slug.md`. Take the highest number
there and add one. Add one row to `docs/decisions/README.md`.

A decision is never edited to change its meaning. A new decision names the old
one and replaces it.

## Template

```md
# NNNN Short title of the decision

Date: YYYY-MM-DD. Status: accepted.

## Context

What forced the choice, what we chose, and why.
```

One paragraph is enough. The value is the record that we chose, and why.

## Optional sections

Add one only when it earns its place:

- **Options considered:** when the losers are worth remembering.
- **Consequences:** when an effect later on is not obvious.
- **Status** `superseded by NNNN`: when a newer decision replaces it.

## What deserves a decision

All three must hold: hard to undo, surprising, a real trade-off.

- **The shape of the system.** "A harness is a session thread."
- **How two parts talk.** "Hono opens the session in a middleware."
- **A choice that locks us in.** A database, a runtime, a test runner. Not
  every library; only one that takes weeks to swap.
- **A boundary.** "React is a thin adapter, not a store." A clear "no" is as
  useful as a "yes".
- **A deliberate break from the obvious path.** "We grep our own style census,
  not a copied lint." This stops the next person from "fixing" it.
- **A limit the code does not show.** A size budget, a speed budget, an outside
  contract.
- **A rejected option that looks good.** Record why, or someone proposes it
  again in six months.
