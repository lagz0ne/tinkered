---
name: domain-modeling
description: Build and sharpen this repo's domain model. Use when discussing codebase terms, editing docs/glossary.md, or writing or editing a decision in docs/decisions/.
---

# Domain modeling

This skill changes the model while you design. You challenge terms, invent edge
cases, and write each term and decision down the moment it settles.

Reading `docs/glossary.md` for words is not this skill. Any skill does that.

## Where things live

```text
docs/
├── glossary.md      # one row per term
└── decisions/
    ├── README.md    # one index row per decision
    └── 0062-random-is-an-ambient-ctx-capability.md
```

## During the session

### Check words against the glossary

When the user's word clashes with `docs/glossary.md`, say so at once:

> The glossary says "session" is X. You seem to mean Y. Which one?

### Pin down vague words

When a word is vague or means two things, propose one exact term and use it
from then on:

> You say "account". Do you mean the Customer or the User?

### Test with real cases

When the talk is about how concepts relate, invent a concrete case that probes
the edge. Make the user say where one concept ends and the next begins.

### Check the code

When the user says how something works, check that the code agrees. If not,
show the clash:

> The code cancels whole Orders. You said a partial cancel works. Which is
> right?

### Write the term now

When a term settles, add or fix its row in `docs/glossary.md` right away. Do
not save terms for later. Format: [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md).

The glossary holds meanings only. No specs, no notes, no implementation detail.

### Offer a decision rarely

Offer a decision record only when all three hold:

1. **Hard to undo:** changing your mind later costs real work.
2. **Surprising:** a future reader would ask "why this way?"
3. **A real trade-off:** there were other good options, and one won for a
   reason.

If one is missing, skip it. Format: [ADR-FORMAT.md](./ADR-FORMAT.md).
