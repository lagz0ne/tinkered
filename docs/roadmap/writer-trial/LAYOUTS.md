# Checkers pass every valid layout before a trial

Each trial so far found a checker assumption: buttons inside a cell,
a select inside its label, a room select, a label linked by id. The
writer was right each time; the checker was too narrow. This card
moves that search before the trial.
Bottom line: all 8 reference apps build in 5 layouts, and every
checker passes all of them. Four checker bugs turned up and were
fixed.

## How it works

- **Layout kit** (`tools/writer-trial/teacher/layout-kit/`): each
  reference app draws its fields with `Field`, its named tables with
  `NamedTable`, its alert with `Notice`, and its page with `Page`.
- **One setting** (`src/layout-choice.ts`) picks the layout.
- **Five layouts.** Every choice below shows up in at least one:
  - label: wrapped, for-id, or `aria-label`;
  - table name: caption or `aria-label`;
  - row buttons: own column, first cell, or last cell;
  - row header or not; columns in task order or reversed;
  - alert: shown only with text, or always there;
  - page parts: task order, or reversed with each in a section.
- **Canaries** pack each app once per layout. Every layout must pass
  every case. Planted bugs run on the baseline layout and must fail
  their named case.
- `kit-sync.test.mjs` keeps every copy of the kit identical.

## Result

Canaries, all five layouts:

- booking (new reference app): rounds 1–3 pass, repair 29/29,
  transfer 43/43
- loans 53/53
- ballot 57/57
- kitchen 53/53
- locker 50/50
- cinema 41/41
- plan 43/43
- stock 44/44

Every planted bug fails its named case. All five gate proofs pass.

## Checker bugs found

- **plan, stock:** rows were read by cell position, with button text
  included. Reversed columns, a row header, or a button in a cell
  broke 6–11 cases. Now each column is found by its header, and a
  cell's text leaves out its controls.
- **booking, two roots:** when a label lookup found nothing, the
  checker guessed fields by position. So labels that share one id
  across roots passed. Now fields are found by label only.
- **booking, undo:** it never checked that the booking form's text
  survives undo, though packet 4 asks for it. Now it does.
- **booking, failed save:** it read the alert at once. That can race
  when the alert is always there, so now it waits for the text.

## One saved app now fails

learn-01 transfer-2 worker-4 links labels with `useId`, so two roots
share label targets. The guidelines forbid that. It now fails one
case, "browser: two roots on one page share nothing", in rounds 4 and 5. It passes everything else. The canary records that.
