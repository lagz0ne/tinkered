# Capsule

A capsule holds a feature's config, its exports
and its hooks. A cmd installs it with values,
and code reaches each unit through the install.

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
const tide = sea({ size: Number(env.SEA_SIZE) });
const app = createScope({
  signal: stop.signal,
  capsules: [tide],
});
const live = await app.ready;
await live.run(tide.press, { input: { x: 9 } });
```

- `ready` throws if the start fails.
  `app.settled` gives the same end as a value:
  `success`, `cancelled` or `failed`.
- Config goes in the call, never as root
  `tags`.
- Keep the install in a const, and reach a unit
  through it: `tide.waves`. Never a bare unit,
  never a raw import from its file.
- A feature that needs another feature's op
  takes it in a slot, filled from an install:
  `welcome({ send: mailer.send })`.
- The cmd is one top-level `createScope`. No
  wrapper function builds it.

## No barrel

A file exports only what it declares. Import a
name from the file that declares it:
`import { sea } from "@/sea/contract"`.
