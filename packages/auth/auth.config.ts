import { createAuth } from "./src/better-auth.ts";

/** CLI only: schema generation needs no live database or production settings. */
export const auth = createAuth(
  {},
  {
    secret: "schema-generation-only-no-live-session-keys",
    baseURL: "http://localhost:3000",
  },
  {},
);
