# Flight reference answer

This private answer starts from `apps/start-scaffold` at `0f0a83fe`.
The copied scaffold files stay unchanged.
Each round adds feature files and changes the app's open files.
The teacher never mounts this answer into a writer's container.

## Run

Use the scaffold's installed dependencies from this worktree:

```bash
ref=tools/flight-trial/reference
ln -s "$PWD/apps/start-scaffold/node_modules" \
  "$ref/node_modules"
cp "$ref/.env.example" "$ref/.env"
node "$ref/run.mjs" build
node "$ref/run.mjs" start
```

The link already exists in the writer's proof worktree.
Set the database and SMTP addresses to the real local services.
The reference uses the same account and database code as the scaffold.
Use a separate Postgres database for the reference proof.
`run.mjs` runs the child from the reference folder.
It passes stop signals to that child and waits for its exit.

## Proof

The teacher README gives the settings and round commands.
Run checks only against trusted local code here.
The harness isolates submitted code before starting it.

`canaries.mjs` passes the reference twice, then plants one break.
It checks that the named behavior fails, then restores the file.
Its logs land in this folder's `.logs/`.
