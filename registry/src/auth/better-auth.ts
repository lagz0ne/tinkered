import { queueAfterTransactionHook } from "@better-auth/core/context";
import type { Auth } from "./index.ts";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";

/** Shared by the lazy resource and the CLI config: generated tables follow the
 * shipped options. The database is borrowed; auth never closes it. */
export function createAuth(
  db: object,
  settings: { secret: string; baseURL: string },
  schema: Record<string, unknown>,
  sendMail?: (input: Auth.MailInput) => Promise<void>,
) {
  return betterAuth({
    ...settings,
    basePath: "/api/auth",
    database: drizzleAdapter(db, { provider: "pg", schemaName: "auth", schema, transaction: true }),
    emailAndPassword: {
      enabled: true,
      sendResetPassword: sendMail
        ? ({ user, url }) =>
            queueAfterTransactionHook(() =>
              sendMail({
                template: "resetPassword",
                props: { url },
                to: user.email,
                subject: "Reset your password",
              }),
            )
        : undefined,
    },
    emailVerification: sendMail
      ? {
          sendOnSignUp: true,
          /** Sign-up's transaction must release PGlite before the mail insert (ADR 0075). */
          sendVerificationEmail: ({ user, url }) =>
            queueAfterTransactionHook(() =>
              sendMail({
                template: "verifyEmail",
                props: { url },
                to: user.email,
                subject: "Verify your email",
              }),
            ),
        }
      : undefined,
    logger: { disabled: true },
  });
}
