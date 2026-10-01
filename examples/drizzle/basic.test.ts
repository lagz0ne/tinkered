import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { migrate, migrationConfig } from "@tinker/drizzle/pglite";
import { addUser, listNames, databaseNamespace, migrationsFolder } from "./index.ts";

const migrations = migrationConfig({ migrationsFolder });

test("the root reads the name committed by its session", async () => {
  const stop = new AbortController();
  const scope = createScope({ signal: stop.signal });
  try {
    await scope.ready;
    await scope.run(migrate, { ns: databaseNamespace, tags: [migrations] });
    await scope.session({ ns: databaseNamespace }, (session) =>
      session.run(addUser, { input: "ada" }),
    );
    const rows = await scope.run(listNames, { ns: databaseNamespace });
    expect(rows.map((row) => row.name)).toEqual(["ada"]);
  } finally {
    stop.abort();
    await scope.closed;
  }
});

test("each root starts with a fresh database", async () => {
  const firstStop = new AbortController();
  const firstRoot = createScope({ signal: firstStop.signal });
  try {
    await firstRoot.ready;
    await firstRoot.run(migrate, { ns: databaseNamespace, tags: [migrations] });
    await firstRoot.session({ ns: databaseNamespace }, (session) =>
      session.run(addUser, { input: "ada" }),
    );
  } finally {
    firstStop.abort();
    await firstRoot.closed;
  }
  const nextStop = new AbortController();
  const nextRoot = createScope({ signal: nextStop.signal });
  try {
    await nextRoot.ready;
    await nextRoot.run(migrate, { ns: databaseNamespace, tags: [migrations] });
    expect(await nextRoot.run(listNames, { ns: databaseNamespace })).toEqual([]);
  } finally {
    nextStop.abort();
    await nextRoot.closed;
  }
});
