import { preset } from "@tinker/core/testing";
import { expect, expectTypeOf, test } from "vite-plus/test";

import {
  createScope,
  extension,
  isError,
  operation,
  resource,
  tag,
  type Operation,
  type Resource,
  type Scope,
  type Tag,
} from "@/index";

/** What the slot tests hold: a store with one field to read. */
type Store = { readonly id: string };

const storeSlot = tag<Resource.Handle<Store>>({ label: "sync.store" });
const migrateSlot = tag<Operation.Handle<string, void>>({ label: "sync.migrate" });
const sqlite = resource({ label: "sqlite", factory: (): Store => ({ id: "sqlite" }) });
const migrate = operation({ label: "migrate", run: (): string => "migrated" });

/** A library: it resolves the store the slot holds and runs the migration it was handed. */
const sync = extension({
  label: "sync",
  config: { store: storeSlot, migrate: migrateSlot },
  hooks: {
    start: (event) => ({
      store: event.resolve(event.resolve(storeSlot)),
      ran: event.run(event.resolve(migrateSlot)),
    }),
  },
});

/** A unit that reads what the library resolved, the way an app's own operations do. */
const whoami = operation({
  label: "whoami",
  depends: { sync },
  run: ({ sync }) => sync.store.id,
});

/** An env value the way a command passes it: a string, or `undefined` when it is unset. */
const envValue = (raw: string | undefined): string | undefined => raw;

/** The error `fn` raised, so a test reads it the way a caller does — narrow, or rethrow. */
const caught = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
};

test("a filled key binds its tag for a unit that reads it", async () => {
  const from = tag<string>({ label: "mail.from" });
  const greeting = resource({
    label: "greeting",
    depends: { from },
    factory: ({ from }) => `hi ${from}`,
  });
  const mail = extension({ label: "mail", config: { from } });

  const scope = createScope({ extensions: [mail({ from: "ops@example.com" })] });
  await scope.ready;

  expect(scope.resolve(greeting)).toBe("hi ops@example.com");
  await scope.close();
});

test("a required key left out fails start with MissingConfig", () => {
  const from = tag<string>({ label: "mail.from" });
  const mail = extension({ label: "mail", config: { from } });

  // @ts-expect-error a required key is left out
  const error = caught(() => createScope({ extensions: [mail({})] }));

  if (!isError(error, "MissingConfig")) throw error;
  expect(error.payload).toEqual({ label: "mail", key: "from" });
});

test("an uncalled extension with a required key fails start the same way", () => {
  const from = tag<string>({ label: "mail.from" });
  const mail = extension({ label: "mail", config: { from } });
  /** An install list that never filled the key: the type refuses it, so this reads the runtime. */
  const unfilled: Scope.Extension<unknown> = mail;

  const error = caught(() => createScope({ extensions: [unfilled] }));

  if (!isError(error, "MissingConfig")) throw error;
  expect(error.payload).toEqual({ label: "mail", key: "from" });
});

test("a key filled with undefined counts as missing", () => {
  const host = tag<string | undefined>({ label: "mail.host", default: "localhost" });
  const mail = extension({ label: "mail", config: { host: host.required } });

  const error = caught(() => createScope({ extensions: [mail({ host: undefined })] }));

  if (!isError(error, "MissingConfig")) throw error;
  expect(error.payload).toEqual({ label: "mail", key: "host" });
});

test("an optional key left out reads the tag's default; an optional edge reads absent", async () => {
  const port = tag({ label: "mail.port", default: 25 });
  const level = tag<string>({ label: "mail.level" });
  const settings = resource({
    label: "settings",
    depends: { port, level: level.optional },
    factory: ({ port, level }) => ({ port, level }),
  });
  const mail = extension({ label: "mail", config: { port, level: level.optional } });

  const scope = createScope({ extensions: [mail({})] });
  await scope.ready;

  expect(scope.resolve(settings)).toEqual({ port: 25, level: { present: false } });
  expect(scope.resolve(level.optional)).toEqual({ present: false });
  await scope.close();
});

test("an extension with no config is the extension itself, not a callable", async () => {
  const events = extension({ label: "events", hooks: { start: () => ({ ok: true }) } });

  expect("config" in events).toBe(false);

  const scope = createScope({ extensions: [events] });
  await scope.ready;

  expect(scope.resolve(events)).toEqual({ ok: true });
  await scope.close();
});

test("a tag.required key is filled like any other", async () => {
  const port = tag({ label: "mail.port", default: 25 });
  const read = operation({
    label: "read port",
    depends: { port: port.required },
    run: ({ port }) => port,
  });
  const mail = extension({ label: "mail", config: { port: port.required } });

  const scope = createScope({ extensions: [mail({ port: 8080 })] });
  await scope.ready;

  expect(scope.run(read)).toBe(8080);
  await scope.close();
});

test("a tags binding on the root wins over the extension's", async () => {
  const port = tag({ label: "mail.port", default: 25 });
  const read = operation({ label: "read", depends: { port }, run: ({ port }) => port });
  const mail = extension({ label: "mail", config: { port } });

  const scope = createScope({ tags: [port(8080)], extensions: [mail({ port: 25 })] });
  await scope.ready;

  expect(scope.run(read)).toBe(8080);
  await scope.close();
});

/** A list reads last binding first, the same rule that makes a later binding win, so a list key
 * reads back in reverse of the call's order. */
test("a list key binds one tag per item, and all reads them last first", async () => {
  const hook = tag<string>({ label: "auth.hook" });
  const hooks = resource({
    label: "hooks",
    depends: { hook: hook.all },
    factory: ({ hook }) => hook,
  });
  const auth = extension({ label: "auth", config: { hook: hook.all } });

  const scope = createScope({ extensions: [auth({ hook: ["first", "second"] })] });
  await scope.ready;

  expect(scope.resolve(hook.all)).toEqual(["second", "first"]);
  expect(scope.resolve(hooks)).toEqual(["second", "first"]);
  await scope.close();
});

test("an empty or left-out list key reads an empty list", async () => {
  const hook = tag<string>({ label: "auth.hook" });
  const auth = extension({ label: "auth", config: { hook: hook.all } });

  const empty = createScope({ extensions: [auth({ hook: [] })] });
  await empty.ready;
  expect(empty.resolve(hook.all)).toEqual([]);
  await empty.close();

  const left = createScope({ extensions: [auth({})] });
  await left.ready;
  expect(left.resolve(hook.all)).toEqual([]);
  await left.close();
});

test("a slot key holds a resource, and a unit reads the one the library resolved", async () => {
  const scope = createScope({ extensions: [sync({ store: sqlite, migrate })] });
  await scope.ready;

  expect(scope.run(whoami)).toBe("sqlite");
  await scope.close();
});

test("a preset on the unit a slot holds reaches the unit that reads it", async () => {
  const scope = createScope({
    extensions: [sync({ store: sqlite, migrate })],
    presets: [preset(sqlite, (): Store => ({ id: "fake" }))],
  });
  await scope.ready;

  expect(scope.run(whoami)).toBe("fake");
  await scope.close();
});

test("a slot key holds an operation, and the library runs the one it was handed", async () => {
  const scope = createScope({ extensions: [sync({ store: sqlite, migrate })] });
  await scope.ready;

  expect(scope.resolve(sync)).toEqual({ store: { id: "sqlite" }, ran: "migrated" });
  await scope.close();
});

test("resolve reads the start value of the callable and of the copy alike", async () => {
  const from = tag<string>({ label: "mail.from" });
  const mail = extension({
    label: "mail",
    config: { from },
    hooks: { start: (event) => ({ from: event.resolve(from) }) },
  });
  const filled = mail({ from: "ops@example.com" });

  const scope = createScope({ extensions: [filled] });
  await scope.ready;

  expect(scope.resolve(filled)).toEqual({ from: "ops@example.com" });
  expect(scope.resolve(mail)).toEqual({ from: "ops@example.com" });
  await scope.close();
});

test("one library installed twice raises DuplicateExtension", () => {
  const from = tag<string>({ label: "mail.from" });
  const mail = extension({ label: "mail", config: { from } });

  const error = caught(() =>
    createScope({ extensions: [mail({ from: "a" }), mail({ from: "b" })] }),
  );

  if (!isError(error, "DuplicateExtension")) throw error;
  expect(error.payload).toEqual({ label: "mail" });
});

test("a config tag's parse refuses a bad value at createScope", () => {
  const port = tag({
    label: "mail.port",
    parse: (raw) => {
      if (typeof raw !== "number") throw new Error("not a number");
      return raw;
    },
  });
  const mail = extension({ label: "mail", config: { port } });

  // @ts-expect-error a port is a number
  const error = caught(() => createScope({ extensions: [mail({ port: "eighty" })] }));

  if (!isError(error, "DataValidationFailed")) throw error;
  expect(error.payload.label).toBe("mail.port");
});

test("a config's values type as the tags say", () => {
  const from = tag<string>({ label: "tt.from" });
  const port = tag({ label: "tt.port", default: 25 });
  const names = tag<string>({ label: "tt.names" });
  const store = tag<Resource.Handle<Store>>({ label: "tt.store" });
  const mail = extension({ label: "tt", config: { from, port, names: names.all, store } });

  expectTypeOf(mail).parameter(0).toMatchTypeOf<{
    from: string | undefined;
    store: Resource.Handle<Store> | undefined;
    port?: number;
    names?: readonly string[];
  }>();
  expectTypeOf<{ from: string; store: Resource.Handle<Store> }>().toMatchTypeOf<
    Parameters<typeof mail>[0]
  >();
  expectTypeOf(mail({ from: "a", store: sqlite })).toEqualTypeOf<Scope.Extension<void>>();
  mail({ from: "a", store: sqlite, names: ["one"] });
  mail({ from: envValue("a"), store: sqlite });

  // @ts-expect-error a required key is missing
  mail({ store: sqlite });
  // @ts-expect-error `from` is the wrong type
  mail({ from: 1, store: sqlite });
  // @ts-expect-error a list key takes a list, not one item
  mail({ from: "a", store: sqlite, names: "one" });
  // @ts-expect-error a slot key takes the resource's handle, not its value
  mail({ from: "a", store: { id: "sqlite" } });
  // @ts-expect-error a slot key takes the resource's handle, not an operation
  mail({ from: "a", store: migrate });
});

test("extensions takes a filled configurable one, never an unfilled one", () => {
  const from = tag<string>({ label: "tt.from" });
  const port = tag({ label: "tt.port", default: 25 });
  const mail = extension({ label: "tt", config: { from } });
  const soft = extension({ label: "tt.soft", config: { port } });
  /** Never called: it only has to type-check. */
  const install = (options: Scope.RootOptions): void => void options;

  install({ extensions: [mail({ from: "a" })] });
  install({ extensions: [soft] });
  // @ts-expect-error a required key is unfilled
  install({ extensions: [mail] });

  /** A config object passed through a variable keeps the fillable type. */
  const def = { label: "tt.var", config: { from } };
  const viaVar = extension(def);

  install({ extensions: [viaVar({ from: "a" })] });
  // @ts-expect-error a required key is unfilled
  install({ extensions: [viaVar] });
});

test("a tag says whether it has a default", () => {
  expectTypeOf(tag({ label: "tt.defaulted", default: 1 })).toEqualTypeOf<Tag.Defaulted<number>>();
  expectTypeOf(tag<number>({ label: "tt.required" })).toEqualTypeOf<Tag.Handle<number>>();
  expectTypeOf(tag<number>({ label: "tt.required" })).not.toEqualTypeOf<Tag.Defaulted<number>>();
});

test("resolve of a configurable extension is typed with its start hook's value", () => {
  const from = tag<string>({ label: "tt.from" });
  const mail = extension({
    label: "tt",
    config: { from },
    hooks: { start: () => ({ client: "smtp" }) },
  });
  const resolveFrom = (scope: Scope.Handle) => scope.resolve(mail);

  expectTypeOf(resolveFrom).returns.toEqualTypeOf<{ client: string }>();
});
