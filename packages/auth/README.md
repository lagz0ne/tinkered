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
const identity = auth(store.db, schema);
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
    store.config(client),
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
`store.tx`, without taking a second database connection.
Auth routes at `/api/auth/*` use Better Auth's own transactions.
Its HTTP answers pass through unchanged.
Email checks, password resets, and plugins are not enabled.

## Tables and checks

The example app is in `tests/fixture`.
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
- Sign out ends the session even when the old cookie is sent again.
- A wrong password keeps Better Auth's status and answer.
- Sign in and requests take turns with work holding the one database connection.
- A piece rejects a second live root and can restart after its owner closes.
- Bad auth settings stop boot before the port opens and name every bad key.
- Auth wiring without its started piece rejects the request with a named error.
- Fresh auth generation matches the saved schema and rejects an edited copy.
- The app and auth tables match the one migration history.
- HTTPS and a 32 character secret pass the boot settings check.
