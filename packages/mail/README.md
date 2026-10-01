# @tinker/mail

Mail is an operation backed by the app's jobs queue.
Upyo 0.6.0 sends it.
React Email 6.11.0 renders it in the worker.

Register templates at the root.
The job saves a template name and JSON props.
Keep that name registered while saved jobs still use it.
Props must be JSON data; React functions stay at the root.

```ts
import { createElement } from "react";
import { Html, Text } from "react-email";
import { operation } from "@tinker/core";
import { jobs } from "@tinker/jobs";
import { mail } from "@tinker/mail";
import { database, transaction } from "./database.ts";

const Welcome = ({ name }: { name: string }) =>
  createElement(Html, null, createElement(Text, null, `Hello ${name}!`));

const post = mail(
  { welcome: Welcome },
  {
    env: {
      MAIL_URL: "smtp://user:pass@smtp.example.com:587",
    },
    from: "team@example.com",
  },
);
const queue = jobs([post.job], {
  pglite: database,
  tx: transaction,
  env: {},
});
const sendMail = post.sendMail(queue.send);

export const welcome = operation({
  label: "welcome",
  depends: { sendMail },
  run: ({ sendMail }) =>
    sendMail.run({
      input: {
        template: "welcome",
        props: { name: "Ada" },
        to: "ada@example.com",
        subject: "Welcome",
      },
    }),
});
```

List `post.extension` before `queue.extension` at the root.
Put other job rows beside `post.job` in the same queue.
For Postgres, omit `pglite` and supply `env.JOBS_URL`.
Jobs uses the request's transaction to save the mail row.
A throw or a raised error mapped to 4xx rolls it back.

Production has no mail backend default.
`MAIL_URL` must use `smtp://user:pass@host:port`.
It is checked at boot, before any transport is opened.
Port 587 is used when the URL omits its port.
URL-encoded credentials are decoded at boot.
Bad config raises `InvalidConfig` with `{ key: "MAIL_URL" }`.
The scope owns SMTP connections and closes them at shutdown.

The worker renders HTML and text and passes its signal to Upyo.
A retryable failure throws `DeliveryFailed` for jobs to retry.
A receipt with `retryable: false` calls jobs' `failJob`.
That job rolls back, stays failed, and logs one line.
A receipt with no retry choice uses the queue's retry policy.
`from` on a call overrides the sender supplied at the root.

Only the dev host binds `post.backend("log")`.
Each mail writes one `mail sent` line through the scope's sink.
Its fields are `to`, `subject`, and `text`.

Tests bind Upyo's mock through the test helper.
`sent()` reads plain mail data, with no Upyo imports in the app.
Upyo records failed attempts too.
`failNext(errors, retryable)` sets the next delivery result.
Advance `createJobsClock` from `@tinker/jobs/testing`
and poll the saved job state before reading sent mail.

```ts
import { createMailMock } from "@tinker/mail/testing";

const mock = createMailMock(post.backend);
const tags = [mock.binding];
const sentMail = mock.sent();
```

## Promises

- A committed request sends one mail rendered from its template.
- A throwing request sends no mail.
- A raised error mapped to 409 sends no mail.
- A retryable delivery failure retries then sends.
- A permanent delivery failure fails once and logs one line.
- The log backend writes one line per mail.
- An open request adds mail while due jobs wait for PGlite.
- A missing or bad MAIL_URL fails boot naming the key.
- MAIL_URL sends over SMTP with its credentials and closes the connection.
- Forced close aborts a mail job waiting on SMTP.
- The graph traces queuing mail and delivering it.
