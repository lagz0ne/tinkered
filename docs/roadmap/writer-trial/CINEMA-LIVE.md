# Fifth live gate trial (cinema-01)

One fresh task (a cinema seat map), one writer: DeepSeek v4.1
Flash, the only writer kept after 2026-09-25 (cost).
Bottom line: accepted first try in 8 minutes, 41/41, gate pass,
no payload miss. The gate never had to block.

## Setup

- **Task:** `tools/writer-trial/cinema/01-seat-map.md`.
- **Checker:** 41 cases, incl. the non-text seat id through
  `{ input }` and `{ rawInput }`. 15 canaries pass.
- **Gate proof:** reference passes; planted blank-number default
  (0.96), same-customer check after the limit guard (0.83), and
  `value as string` (S17) each block.
- **Watch:** the correct `buySeats` scores 0.52–0.62 on
  `noOpRejected` against a 0.66 bar. It did not block here.

## Result

- **DeepSeek Flash** — accepted first try. 8 minutes,
  10 Jev calls, 0 blocks. Own check, 58 tests, and build exit 0;
  41/41 teacher cases; gate `pass`. Lead review: the
  same-customer check runs before SeatTaken, SeatSold, and
  SeatLimit; public operations read `ctx.rawInput`; no casts;
  the view only reads cells and runs operations.

## DeepSeek across the five gate trials

- loans-01: 1 repair (T08, `isError` in `expect`), 12 min.
- ballot-01: first try, 12 min.
- kitchen-01: first try, 15 min.
- locker-01: first try.
- cinema-01: first try, 8 min.

## Where things live

- Trial folder: `~/.local/share/tinker-writer-trial/cinema-01/`.
- Projects, workspaces, containers, volumes: removed.
