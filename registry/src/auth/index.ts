import { extension, resource, tag, type Operation, type Resource, type Scope } from "@tinker/core";
import type { HonoScope } from "../hono/index.ts";
import { raise } from "./errors.ts";

export { authTemplates } from "./templates.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

export declare namespace Auth {
  type MailProps = { url: string };
  type MailInput = {
    template: "verifyEmail" | "resetPassword";
    props: MailProps;
    to: string;
    subject: string;
  };
  /** Borrow a send operation that inserts on auth's database, without a request transaction. */
  type Mails = { sendMail: Operation.Handle<Promise<string | null>, MailInput> };
  type Config = { BETTER_AUTH_SECRET?: string; BETTER_AUTH_URL?: string };
  /** App data only; cookies, tokens, and password hashes stay inside Better Auth. */
  type User = {
    id: string;
    name: string;
    email: string;
    emailVerified: boolean;
    image?: string | null;
  };
}

/** One piece per live root. Hono awaits the user read before it opens a request
 * session. Auth's own routes use the borrowed database directly (ADR 0075).
 * List the extension beside Hono and spread its wiring into Hono's wiring. */
export function auth(
  database: Resource.Handle<Promise<object>>,
  schema: Record<string, unknown>,
  mails?: Auth.Mails,
) {
  const config = tag<Auth.Config>({ label: "auth.config" });
  const user = tag<Auth.User | null>({ label: "auth.user", default: null });
  const settings = resource({
    label: "auth.settings",
    depends: { config: config.optional },
    factory: ({ config }) => readSettings(config.present ? config.value : {}),
  });
  const client = resource({
    label: "auth.client",
    depends: { db: database, settings, ...mails },
    factory: async ({ db, settings, sendMail }) => {
      const { createAuth } = await import("./better-auth.ts");
      return createAuth(
        db,
        settings,
        schema,
        sendMail
          ? async (input) => {
              await sendMail.run({ input });
            }
          : undefined,
      );
    },
  });
  let owner: Scope.Handle | undefined;
  const piece = extension({
    label: "auth",
    hooks: {
      start: async (event) => {
        if (owner) raise("PieceInUse", { label: "auth" });
        event.scope.resolve(settings);
        owner = event.scope;
        event.defer(() => {
          owner = undefined;
        });
        await event.next();
      },
    },
  });
  const readClient = () => {
    if (!owner) raise("NotStarted", { label: "auth" });
    return owner.resolve(client);
  };
  const wiring: HonoScope.Wiring = {
    tags: async (c) => {
      if (c.req.path.startsWith("/api/auth/")) return user(null);
      const { response: session, headers } = await (
        await readClient()
      ).api.getSession({
        headers: c.req.raw.headers,
        returnHeaders: true,
      });
      for (const cookie of headers.getSetCookie()) c.header("Set-Cookie", cookie, { append: true });
      return user(
        session === null
          ? null
          : {
              id: session.user.id,
              name: session.user.name,
              email: session.user.email,
              emailVerified: session.user.emailVerified,
              image: session.user.image,
            },
      );
    },
    mount: (app) => {
      app
        .basePath("/api/auth")
        .on(["GET", "POST"], "*", async (c) => (await readClient()).handler(c.req.raw));
    },
  };
  return { extension: piece, config, user, wiring };
}

function readSettings(config: Auth.Config): { secret: string; baseURL: string } {
  const keys: string[] = [];
  const secret = config.BETTER_AUTH_SECRET ?? "";
  if (secret.length < 32) keys.push("BETTER_AUTH_SECRET");
  const baseURL = config.BETTER_AUTH_URL ?? "";
  const url = URL.parse(baseURL);
  if (!url || !["http:", "https:"].includes(url.protocol)) keys.push("BETTER_AUTH_URL");
  if (keys.length > 0) raise("BadAuthSettings", { keys });
  return { secret, baseURL };
}
