# 0083 Mail is one operation for the app, with Upyo behind it

Date: 2026-09-29. Status: accepted. Replaces in part: 0075 §4 (nodemailer; Mailpit in dev).
Builds on: 0075 (mail through a job), 0077 (glue lives in its home package), 0081 (a piece is an
extension), 0082 (only dev and tests bind defaults). Research: `docs/roadmap/stack-v1/RESEARCH.md`,
round 6.

## Context

The user wants mail to be one standard API with backends to swap, as Drizzle is for databases.
ADR 0081 keeps every outside library behind authoring units.

**The precedent is Laravel and Rails.** Both own their mail API and borrow the backends
underneath: Laravel over Symfony Mailer, Rails over the `mail` gem.

Upyo (0.6.0, MIT) gives one `Transport` type. Its `send` takes a `signal`, and its `Receipt` says
whether a failure can be retried. It has backends for SMTP, SES, Resend, Mailgun, and SendGrid,
and a mock that keeps every sent mail for tests. It has one main maintainer. Nodemailer keeps no
list of sent mail, and its Resend and Postmark add-ons do not accept version 10 yet.

## Decision

1. **`@tinker/mail` is a new piece:** the `mail()` extension, a `sendMail` operation, and a
   `mailer` resource.
2. **The app calls `sendMail`** with a React Email template and its props. It adds a mail job in
   the request's transaction (ADR 0075); the job renders the template and sends.
3. **Upyo is the backend layer,** pinned to an exact version. The app never imports it.
4. **One setting picks the backend:** `MAIL_URL`, e.g. `smtp://user:pass@smtp.resend.com:587`,
   as Symfony Mailer's `MAILER_DSN` does. `start` checks it (ADR 0081).
5. **Dev logs each mail; tests use Upyo's mock.** The dev host and the test helper bind these
   (ADR 0082). Mailpit is not needed, and still works as an SMTP target.

## Consequences

- Swapping Upyo touches only `@tinker/mail`. Its `Transport` has two methods, so we can write our
  own if it is abandoned.
- Upyo has no Postmark backend; SMTP reaches Postmark.
