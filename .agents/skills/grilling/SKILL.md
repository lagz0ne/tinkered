---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round: number each question and give your recommended answer. Then wait for the user's answers before the next round.

Format a round like so — **at most three questions per round**, the shortest form that shows the
choice. When the choice is about code, show the options as code. When it is about flow or order, show
a call stack or a short ASCII sequence. Prose only when neither fits. One line of ask, one line of
recommendation:

````
❓ **Q1** - <one-line ask>

```ts
// A: <label>
<the shape under A, real names from the repo>

// B: <label>
<the shape under B>
````

➡️ A

---

❓ **Q2** - <one-line ask>

```text
A: <call stack or sequence under A>
B: <call stack or sequence under B>
```

➡️ B

```

Routine choices (naming, ordering, defaults with a conventional answer) are not questions: state
them in one closing line as "I will take these as routine unless you object" and move on.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
```
