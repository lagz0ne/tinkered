import { PGlite } from "@electric-sql/pglite";
import { resource, tag, type Scope } from "@tinker/core";
import { openTransaction } from "../../src/drizzle/index.ts";
import { jobs } from "../../src/jobs/index.ts";
import { createJobsClock } from "../../src/jobs/testing.ts";
import { drizzle } from "drizzle-orm/pglite";
import { createElement, type ReactElement } from "react";
import { Body, Html, Text } from "react-email";
import { afterAll, afterEach, beforeAll } from "vite-plus/test";
import { mail, type Mail } from "../../src/mail/index.ts";
import { createMailMock } from "../../src/mail/testing.ts";

const databaseConfig = tag<PGlite>({ label: "test.database" });
const database = resource({
  label: "test.db",
  target: "namespace",
  depends: { client: databaseConfig },
  factory: ({ client }) => Promise.resolve(drizzle({ client })),
});
const transaction = resource({
  label: "test.tx",
  target: "session",
  depends: { db: database },
  factory: ({ db }, ctx) => openTransaction(db, ctx),
});
export function Welcome({ name }: { name: string }): ReactElement {
  return createElement(
    Html,
    null,
    createElement(Body, null, createElement(Text, null, `Hello ${name}!`)),
  );
}
export const input = {
  template: "welcome",
  props: { name: "Ada" },
  to: "ada@example.com",
  subject: "Welcome",
} as const;
export const scopes: Scope.Handle[] = [];
const clients: PGlite[] = [];
let template: PGlite;

beforeAll(async () => {
  template = new PGlite();
  await template.waitReady;
});
afterEach(async () => {
  await Promise.all(scopes.splice(0).map((scope) => scope.close()));
  await Promise.all(clients.splice(0).map((client) => client.close()));
});
afterAll(async () => {
  await template.close();
});

export async function fixture(
  backend?: Mail.Backend,
  wiring: Mail.Wiring = { env: {}, from: "team@example.com" },
) {
  /** PGlite's clone declaration loses its concrete class. */
  const client = (await template.clone()) as PGlite;
  clients.push(client);
  const piece = mail({ welcome: Welcome }, wiring);
  const mock = createMailMock(piece.backend);
  const clock = await createJobsClock("2030-01-01T00:00:00Z");
  const queue = jobs([piece.job], { pglite: database, tx: transaction, env: {} });
  const sendMail = piece.sendMail(queue.send);
  const tags = [
    databaseConfig(client),
    clock.binding,
    ...(backend ? [piece.backend(backend)] : wiring.env.MAIL_URL ? [] : [mock.binding]),
  ];
  return {
    client,
    piece,
    queue,
    clock: { advance: clock.advance },
    mock,
    sendMail,
    tags,
    extensions: [piece.extension, queue.extension],
  };
}
export async function readStates(client: PGlite) {
  return (await client.query("select state, retry_count from pgboss.job order by created_on")).rows;
}
