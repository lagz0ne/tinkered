# 0115 A new app starts from the template repo

Date: 2026-10-12. Status: proposed.

- User, 2026-10-12: "build the scaffold on github so
  I can start new project quickly from there."
- User: "variation can come off that repo branches
  or tag or both."
- User: "then using degit (or similar faster) tool
  seems to be the way."
- User: "The main repo is going to be a router, to
  correpsonding branches. So, when we send out the
  link to the repo, it'll just work."

Builds on: 0074, 0106, 0114.

## Context

The README path for a new app has 11 commands.
It has one hand edit: `AUTH_SECRET` in `.env`.

- `shadcn add app.json` writes the small app.
- The full demo needs the `starter` item.
- Then doctor names seam lines to add by hand.
- Git and GitHub are left to the user.

## Precedent

- **degit, tiged, giget.** Copy a repo's tree at a
  branch or tag, with no history.
  `user/repo#ref` picks the ref.
- **GitHub template repos.** "Use this template"
  makes a new repo from the default branch.
- **Laravel `key:generate`, Rails master key.**
  The create step writes the app's secret.
- **Epic Stack.** The starter is a plain repo.
  It commits its lockfile.

Ours is simpler: no create package, no prompts.
The variations already exist in this repo.

## Decision

1. `lagz0ne/tinker-app` is the template repo.
   It is public.
2. **A branch is a variation.**
   - `small`: the small app, as `shadcn add app.json`
     writes it.
   - `demo`: the scaffold app, with its release
     `package.json`.
   - `main` is a router: only a README that names
     each variation and its start command.
     A shared link to the repo then just works.
3. **A tag pins a variation to a release.**
   `small-v<version>` and `demo-v<version>`.
4. A new app starts with degit:
   `npx degit lagz0ne/tinker-app#demo my-app`.
   `curl` and `tar` work with no tools.
5. `npm run setup` writes `.env` with a new secret.
   It starts compose, then installs packages.
6. `scripts/template-sync.mjs` writes both trees
   from a tag's checkout.
   With `--push`, it commits each to its branch.
   Then it tags each variation.
7. Each tree commits its `package-lock.json`.
8. The registry stays the way to add items to an
   app that exists.

## Consequences

- The small app starts in 4 commands.
- The demo starts in 4 commands with Docker.
- The release job runs `template-sync --push`.
  The job's `GITHUB_TOKEN` reaches only this repo,
  so it uses the `TINKER_APP_TOKEN` secret.
  Without the secret, the step warns and skips.
- The tags never move.
  A fix goes out as a new release.
- Fetch time is not the cost.
  Timed on 2026-10-12, each tool took under 2 s
  once cached.
  Install and Docker pulls take the most time.

## Options considered

- **A `create-tinker` package.** Needs npm.
  ADR 0114 ships only through GitHub releases.
- **`gh repo create --template`.** It copies only
  the default branch, or every branch.
  It cannot pick one variation.
- **Folders in one branch.** degit can copy a
  folder, but a template button cannot.
- **Small app on `main`.** The template button would
  give a working app, but a shared link would show
  one variation, not the choice.
