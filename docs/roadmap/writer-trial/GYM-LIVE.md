# Gym class waitlist (gym-01)

A sixth unseen task, the first with checkers proven on five layouts
before the trial (`LAYOUTS.md`).
Bottom line: DeepSeek passed on its first try, 43/43, and no checker
broke.

## Before the trial

- Task: `tools/writer-trial/gym/01-class-waitlist.md`: classes with
  a capacity, a waitlist, the first waiting member booked on a leave,
  a bigger capacity booking waiters, a class select, and undo.
- Reference app on the layout kit: 43/43 in every layout.
- 16 planted bugs, each caught by its named case.
- Gate proof: the reference passes; a capacity default blocks on
  `inputDefaultMasks`, a refused repeat join on `noOpRejected`, and a
  cast on S17.

## Result

- DeepSeek v4.1 Flash, 16.6 min, 13 Jev calls.
- The gate blocked twice, both `inputDefaultMasks`: a helper turned a
  non-record input into `{}`. DeepSeek fixed it.
- Own check, 67 tests, and build exit 0. Teacher 43/43. Gate pass.
  Machine pass on check 1. Accepted.

## Notes

- Its public operations also clear form text and set the alert. The
  reference keeps those in screen operations. No rule forbids it.
- `node_modules` is a read-only link, so a bare `npm run dev` fails:
  Vite cannot write `node_modules/.vite`. DeepSeek started Vite with
  its own cache folder in its browser test.
