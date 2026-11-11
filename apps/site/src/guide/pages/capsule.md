# Capsule

A capsule is a feature's one door. It holds the
feature's config, its exports and its hooks. A cmd
installs it with values.

## Write one

```ts
export const sea = capsule({
  label: "sea",
  config: { size: size.required },
  exports: { waves, press },
});
```

- `config`: the keys the feature reads. A
  missing key fails start with `MissingConfig`.
- `exports`: what others may touch. An op is
  called. A cell is read only: `get` and
  `watch`, no `set`.
- `hooks`: `start`, `run`, `write`, `resolve`,
  `close`, `session`.

## Install it

The cmd is the seam. It reads env and fills each
key by name:

```ts
const app = createScope({
  signal: stop.signal,
  capsules: [
    ws.client({ url }),
    sea.board({ read: ws.client }),
    sea.api({ remote: ws.client }),
  ],
});
const live = await app.ready;
```

- Config goes in the call, never as root
  `tags`.
- Reach a unit through the binding:
  `sea.waves`, never a raw import from its file.
- The cmd is one top-level `createScope`. No
  wrapper function builds it.

## One folder, one door

```text
src/sea/
  index.ts          the capsule + pages
  index.server.ts   the server's ops
  contract.ts       rpc + remote data
```

Other features import `@/sea` only.
