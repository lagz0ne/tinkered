# Welcome mail example

"Send a welcome mail when someone signs up",
built from capsules, one need at a time. The
root README walks through it step by step.

## The capsules

- `signup`: keeps the member, calls each
  listener in its `on` slot.
- `welcome`: a listener; it calls `mail.send`.
- `mail`: what features call; it hands each
  letter to the backend in its slot.
- `mail.memory`: a backend for dev and tests.
- `mail.smtp`: a backend that waits for a turn
  in its `throttle` slot.
- `throttler`: one turn per `gapMs`.
- `outbox`: a line in front of a backend. Its
  start hook runs the pump. A graceful close
  sends what is left.
- `audit`: a run hook that sees each
  `mail.send`.

## The tests

One file per step, in `tests/`:

1. A new member gets a letter.
2. The third of three sign-ups waits 200 ms.
3. Sign-up answers at once; a dead address
   ends in `outbox.dead`.
4. A graceful close sends the line; a forced
   close drops it.
5. The audit sees each letter.
6. Devtools shows each span, by capsule.

## Run

From the repository root, after `vp install`
and `vp run -r build`:

```bash
cd examples/welcome
vp run test
vp exec tinker check
vp run start
```

`tinker check` ends with `tinker check: OK`.
`vp run start` prints the audit, the close
status, and the count of each exit.
