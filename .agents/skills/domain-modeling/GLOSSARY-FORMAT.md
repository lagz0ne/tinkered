# Glossary format

`docs/glossary.md` is one table: `term | meaning`. Copy the shape of the rows
already there.

```md
| handle | An object a caller holds to use a thing. |
```

## Rules

- **One word per idea.** When two words name the same thing, pick one. Say in
  the meaning which word to avoid: "Not: bill, payment request."
- **Short meanings.** One or two sentences. Say what it is, not what it does.
- **Only this repo's terms.** General programming ideas (timeout, error type)
  stay out, even when the code uses them a lot. Ask: is this ours, or
  everyone's? Only ours goes in.
- **A term is not jargon.** The prose lint lets a word through once it has a
  glossary row (`docs/writing-style.md`). So add a row only for a word with no
  plainer twin.
