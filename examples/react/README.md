# React example

A small browser app with a counter, a profile, and a draft form.

- The counter can increase and reset.
- The profile loads Ada's name.
- Saving the document shows `saved:doc`.
- The spans button refreshes the recorded span count.
- Typing then saving posts once and clears the draft.
  The save operation returns the form values without a network call.

## Run

Use Node 22.18 or newer and Vite+ (`vp`).
The Tinker packages are not released yet.
From the repository root, build and export a copy:

```bash
vp install
vp run -r build
vp run example:export -- react /tmp/tinker-react
```

The copy includes the Tinker packages it needs.
Run these commands inside that folder:

```bash
cd /tmp/tinker-react
vp install
vp run dev
```

Open the local URL printed by Vite+.
After the repository install and build, the same commands work in
`examples/react`.

## Check

From the example folder:

```bash
vp run build
vp run check
vp run test
vp run preview
```

`preview` serves the built browser app.
The test drives the form through `index.ts` with a recording save operation.
It needs no browser or network service.

## Read the code

- `basic.tsx` declares the counter, profile, and document save once.
- `form.tsx` declares the draft and its edit and save operations once.
- `ScopeProvider` creates and closes each mounted sample's scope.
- `main.tsx` mounts both samples when `index.html` calls it.
- `vite.config.ts` and `tsconfig.json` belong to this folder.
