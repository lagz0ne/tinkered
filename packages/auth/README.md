# @tinker/auth

Email and password sign-up and sign-in through Hono.
Better Auth and its Drizzle adapter are pinned to 1.7.6.
Their [Drizzle guide](https://better-auth.com/docs/adapters/drizzle)
describes schema generation and the relations-v2 entry.

## Wire it

The app owns its store and its generated schema.
`auth` borrows both; closing auth does not close the store.
List its extension in the root and pass its wiring to Hono.
Read `identity.user` in an operation.
It is user data or `null`; it never holds a token.

```ts
const identity = auth(store, schema);
const me = operation({
  label: "me",
  depends: { user: identity.user },
  run: ({ user }) => user,
});
const web = hono([route.get("/me", me)], {
  ...identity.wiring,
}).extension;
const scope = createScope({
  tags: [
    storeConfig({ client }),
    identity.config({
      BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
      BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    }),
  ],
  extensions: [web, identity.extension],
});
```

Use a secret of at least 32 characters and an HTTP or HTTPS
public base URL, such as `https://tasks.example.com`.
A missing or bad setting stops boot and names its key.
The piece supplies no dev or production defaults.
The library loads once, on first use in that root.
A piece can serve one live root at a time.
It can start again after that root closes.

Hono awaits the cookie read before opening the request session.
Operations can then read `identity.user` even after opening
`transaction`, without taking a second database connection.
Auth routes at `/api/auth/*` read their own session;
the tag hook skips its user read there.
Those routes use Better Auth's own transactions.
Its HTTP answers pass through unchanged.

Answer with `c.json`, `c.text`, or `c.body` to keep auth cookies.
For a raw `Response`, copy the auth headers from `c.res.headers`.
Add the route's own cookies to the context before copying:

```ts
route.get("/raw-me", me, {
  respond: (user, c) => {
    c.header("Set-Cookie", "app=1", { append: true });
    c.header("Content-Type", "application/json");
    return new Response(JSON.stringify(user), {
      headers: c.res.headers,
    });
  },
});
```

## Verify and reset mail

Pass a send operation as auth's third argument to enable mail.
Register `authTemplates` in the app's mail piece.
The mail piece supplies the sender; auth reuses `BETTER_AUTH_URL`
for both links.
There are no new settings.
Sign-in still works before verification.

Auth routes use Better Auth's own transaction.
Its mail hook queues the insert after that transaction commits.
A failed sign-up drops the hook and sends nothing.
The insert borrows the same database, with no request transaction.
The queue and auth then take turns on PGlite's one connection.
A failed mail insert can fail the reply after auth has committed.
Delivery retries use the mail queue's normal policy.

```ts
import { operation } from "@tinker/core";
import { auth, authTemplates } from "@tinker/auth";
import { jobs, type Jobs } from "@tinker/jobs";
import type { Operation } from "@tinker/core";
import { mail } from "@tinker/mail";

const post = mail(authTemplates, {
  env: { MAIL_URL: process.env.MAIL_URL },
  from: "team@example.com",
});
const queue = jobs([post.job], {
  pglite: database,
  tx: transaction,
  env: {},
});
const sendAuthJob = operation({
  label: "auth.mail.job",
  depends: { queue: queue.extension, db: database },
  run: ({ queue, db }, ctx: Operation.Ctx<Jobs.Input>) => queue.send(ctx.input, db),
});
const identity = auth(database, schema, {
  sendMail: post.sendMail(sendAuthJob),
});
```

List `post.extension`, `queue.extension`, `identity.extension`,
and Hono's extension at the root.
App operations still use `post.sendMail(queue.send)`;
that path inserts through the request's transaction.

An app can replace either template when registering mail:

```ts
const post = mail(
  {
    ...authTemplates,
    verifyEmail: MyVerifyEmail,
    resetPassword: MyResetPassword,
  },
  {
    env: { MAIL_URL: process.env.MAIL_URL },
    from: "team@example.com",
  },
);
```

Each component receives `{ url: string }`.
Keep the names registered while jobs still use them.
The shipped templates each have one link and a short note.
Without the third argument, auth keeps sign-up and sign-in only.
Plugins are not enabled.

## Tables and checks

The example app is in `tests/fixture`.
The tests declare the database and transaction as static resources.
They borrow a cloned client and close it after its scope closes.
Its generated auth tables live under `pgSchema("auth")`.
Its own `visits` table lives under `public`.
Both join one Drizzle migration history.
The config uses `schemaFilter: ["public", "auth"]`;
pg-boss keeps its own schema and history.
Tests build one template with the stack migrate step,
then clone it for each test.

From this package:

```sh
vp exec auth generate --config auth.config.ts \
  --output tests/fixture/auth-schema.ts --yes
vp fmt tests/fixture/auth-schema.ts
cd tests/fixture
vp exec drizzle-kit generate
```

`auth.config.ts` uses the same options as the shipped piece.
`node check-schema.mjs` generates a fresh file, formats it,
and fails if it differs from the saved schema.
Its optional argument selects the saved file to check.
The check does not edit that file.

## Promises

- Sign up then sign in gives a session cookie accepted by the auth GET route.
- An operation reads the user after opening its transaction and reads none without a cookie.
- An app route refreshes a near-expiry session cookie and keeps its own cookies.
- The auth get-session route refreshes a near-expiry session cookie.
- A raw response keeps refreshed cookies when it copies the context headers.
- Sign out ends the session even when the old cookie is sent again.
- A wrong password keeps Better Auth's status and answer.
- Sign in and requests take turns with work holding the one database connection.
- A piece rejects a second live root and can restart after its owner closes.
- A changed auth secret rejects a cookie from the prior root.
- Bad auth settings stop boot before the port opens and name every bad key.
- Auth wiring without its started piece rejects the request with a named error.
- Fresh auth generation matches the saved schema and rejects an edited copy.
- The app and auth tables match the one migration history.
- HTTPS and a 32 character secret pass the boot settings check.

- Sign-up sends one verify mail whose link verifies the email.
- A reset mail link changes the password and rejects the old password.
- A duplicate sign-up sends no extra mail.
- A sign-up that fails after its mail hook sends no mail.
- Auth mails and due jobs take turns with a request on PGlite.
