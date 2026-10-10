// The sync probe's stand-in for the app's server seam (`#tinker/app.server`). Every tree that runs
// the sync probe gets a copy, so each side loads its own Start source against this one seam.
// An in-memory Postgres (PGlite) holds the sync tables and the wake trigger; an account read is one query.
import { resource } from "@tinker/core";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { PGlite } from "@electric-sql/pglite";

const syncTables = `
CREATE TABLE sync_stream (id text PRIMARY KEY, revision integer DEFAULT 0 NOT NULL);
CREATE TABLE sync_execution (id text PRIMARY KEY, stream text NOT NULL, notification jsonb, result jsonb);
CREATE TABLE sync_event (stream text, revision integer, "executionId" text NOT NULL,
  payload jsonb NOT NULL, PRIMARY KEY (stream, revision));
CREATE FUNCTION start_sync_wake() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_notify('start_sync', TG_TABLE_NAME); RETURN NULL; END; $$;
CREATE TRIGGER sync_event_committed AFTER INSERT ON sync_event
FOR EACH STATEMENT EXECUTE FUNCTION start_sync_wake();
`;

const template = await PGlite.create();
await template.exec(syncTables);

export const database = resource({
  label: "bench.database",
  factory: async (_deps, { defer }) => {
    const client = await template.clone();
    defer(() => client.close());
    return Object.assign(drizzle({ client }), {
      listen: async (wake) => client.listen("start_sync", wake),
    });
  },
});

export const auth = resource({
  label: "bench.auth",
  depends: { database },
  factory: ({ database }) => ({
    handler: async () => new Response(null),
    api: {
      getSession: async ({ headers }) => {
        await database.execute(sql`select 1`);
        const id = headers.get("x-account");
        return id === null ? null : { user: { id } };
      },
    },
  }),
});
