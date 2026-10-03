# Flight reference answer

This private answer starts from `apps/start-scaffold` at `0f0a83fe`.
The copy now includes main's strict Start source at `92b8937f`.
Its response bodies and telemetry queue are resources.
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

The proof worktree uses its own folder of dependency links.
That keeps its TypeScript API tool separate from `apps/`.
Set the database and SMTP addresses to the real local services.
The reference uses the same account and database code as the scaffold.
Use a separate Postgres database for the reference proof.
`run.mjs` runs the child from the reference folder.
It passes stop signals to that child and waits for its exit.

## Proof

The teacher README gives the settings and round commands.
Run checks only against trusted local code here.
The harness isolates submitted code before starting it.

The full integration runner uses the image's shipped scaffold tests.
It adds empty bookings to the sync test fixtures for the flight shape.
It runs the same frozen Jev gate and trusts only exact starter bytes.

`canaries.mjs` passes the reference twice, then plants one break.
It checks that the named behavior fails, then restores the file.
Its logs land in this folder's `.logs/`.

The browser page-close listener is also a resource.
It removes its listener when the router's owner closes.
Run the strict check from the worktree root:

```bash
ref=tools/flight-trial/reference
npm --prefix "$ref" run check:plain
```
