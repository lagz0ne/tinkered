---
name: grilling
description: Grill the user about a plan, decision, or idea until you both agree on it. Use when the user wants to stress-test their thinking, or says "grill".
---

Ask questions until you and the user share one picture. Keep a **design tree**
in your head: each decision opens the decisions that hang off it.

## Rounds

The **frontier** is every decision whose parents are settled. You can ask it
now without guessing an answer you have not heard.

Each round asks the frontier:

- **At most three questions.** Number them.
- **Show, do not tell.** A code choice shows both options as code. A flow or
  order choice shows a call stack or a short sequence. Prose only when neither
  fits.
- **One line of ask, one line of pick.** Give your recommended answer.

Then stop and wait for the answers.

````md
❓ **Q1** - <one-line ask>

```ts
// A: <label>
<the shape under A, real names from the repo>

// B: <label>
<the shape under B>
```

➡️ A

---

❓ **Q2** - <one-line ask>

```text
A: <call stack or sequence under A>
B: <call stack or sequence under B>
```

➡️ B
````

Routine choices are not questions. That covers names, order, and defaults with
a usual answer. List them in one closing line: "I take these as routine unless
you object."

## After each round

The answers move the frontier. Work it out again and ask the next round. A
question that depends on another open question in this round waits for a later
round.

## Facts are yours, decisions are theirs

Never ask the user for a fact you can look up. Send a sub-agent to find it.
Do not wait on it: only the questions that need its answer wait. Ask the rest
now.

Decisions belong to the user. Ask each one and wait.

## Done

The session ends when the frontier is empty: every branch visited, nothing
assumed in silence. Do not act until the user confirms you agree.
