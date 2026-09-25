# Layout kit for teacher reference apps

A checker must pass every valid way to build a screen. The tasks name
fields, tables, row buttons, and the alert; they do not say where a
button sits or how a label links. Trials kept finding checker
assumptions one layout at a time (buttons inside a cell, a select
inside its label, a room select, a label for-id). This kit moves that
search before the trial.

## Contract

- Every reference app (`teacher/<suite>-fixture/src/`) holds a
  byte-identical copy of `layout.tsx` and a `layout-choice.ts`
  that exports `LAYOUT_NAME = "baseline"`.
- Its view draws every labeled field with `Field`, every named table
  with `NamedTable`, and the one alert with `Notice`.
- Its `<suite>-canaries.mjs` packs the app once per name in
  `LAYOUTS`, with `layout-choice.ts` overwritten, and every layout
  must pass every case.
- Bad variants run on the baseline layout.

## Layouts

- **baseline** — wrapped labels, caption, Actions column.
- **L1** — label for-id, aria-label table name, buttons in the last
  cell, alert always present.
- **L2** — aria-label fields, buttons in the first cell, row header,
  reversed columns.
- **L3** — wrapped labels, aria-label table name, buttons in the
  first cell, reversed columns, alert always present.
- **L4** — label for-id, caption, buttons in the last cell, row
  header.

`tools/writer-trial/kit-sync.test.mjs` keeps every copy identical.
