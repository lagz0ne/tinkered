# @tinkered/entry

The backend of a Tinker app. Code only: how to
use it is in the skills.

An app gets this code by version. It is not
copied into the app.

## Entries

Each entry is named by the kind of program that
imports it:

- `@tinkered/entry/cmd`: a command, a program
  with no port.
- `@tinkered/entry/server`: a server, a program
  that listens on a port.

Later, one entry per runtime:

- `@tinkered/entry/bun`: Bun, from
  `@tinkered/bun`.
- `@tinkered/entry/node`: Node.

## State

0.29.x sets the package up. The entries are
empty. The code moves in from the template in
the next releases.
