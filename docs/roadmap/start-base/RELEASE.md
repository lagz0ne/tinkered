# Prepare a GitHub release

Core, React, and Start share version `0.7.0`.
They ship and are tested as one set.
One tag, `start-v0.7.0`, pins that set and its registry.
Only package versions changed in Core and React.

Run from the repo root:

```bash
node scripts/release.mjs 0.7.0
```

`--dry` is the default and may be passed too.
The script has no publish mode.
It never runs `gh`, tags git, pushes, or publishes.
It builds, packs, and fills release URLs in a local folder.
It can also prepare a second version without editing source.
That version changes package metadata only.
Real code changes must be committed before preparing a release.

Files in `.release/start-v0.7.0/`:

- `assets/tinker-core-0.7.0.tgz`
- `assets/tinker-react-0.7.0.tgz`
- `assets/tinker-start-0.7.0.tgz`
- `manifest.json`: sizes, sha256 hashes, and URLs.
- `apps/start-scaffold/public/r/`: each registry item.
- `apps/start-scaffold/app.package.json`
- `apps/start-scaffold/starter.package.json`

The registry files must be committed at these repo paths.
Raw GitHub serves them from the release tag.
They are not uploaded as release assets.
The normal registry build makes the same files for the
version in `packages/start/package.json`:

```bash
vp run @tinker-start-scaffold#registry:build
```

Review the generated files and commit them before tagging.
A release's React package depends on Core's release URL too.
The packed Start manifest pins the bytes doctor checks.
Source package files keep workspace links for repo builds.

## Local proof

```bash
node scripts/proof-github-release.mjs
```

It leaves two dry folders and a scratch app.
It rewrites copies of the URLs to 127.0.0.1.
The paths stay the same as GitHub's paths.
It also rewrites the packed upgrade URL default and pins
those proof bytes again; the original dry assets stay intact.
A real shadcn add starts from an empty folder.
Install, build, doctor, a served page, and upgrade must pass.
Every user file must stay the same through upgrade.
An edited base must stop upgrade before any package write.
Every server stops by its own PID.

## Publish only after the user's go

These are instructions for the lead, not steps this card runs.
Catch up to main, run the gates, and review the proof first.
Keep the package files and generated registry at `0.7.0`.
From a clean, committed repo root:

```bash
node scripts/release.mjs 0.7.0 --dry
git tag start-v0.7.0
git push origin HEAD:main
git push origin start-v0.7.0
```

Then attach the three assets:

```bash
gh release create start-v0.7.0 \
  --repo lagz0ne/tinkered \
  --verify-tag --title 'Start 0.7.0' \
  --notes-file packages/start/UPGRADE.md \
  .release/start-v0.7.0/assets/tinker-core-0.7.0.tgz \
  .release/start-v0.7.0/assets/tinker-react-0.7.0.tgz \
  .release/start-v0.7.0/assets/tinker-start-0.7.0.tgz
```

After publication, check each asset URL and the raw registry
URL in `app.json`, then rerun the empty-app proof using them.
Public GitHub hosting is not proven by the local mirror.
