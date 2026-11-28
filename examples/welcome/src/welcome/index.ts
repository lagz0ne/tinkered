import { capsule, operation, tag, type Operation } from "@tinkered/core";
import { z } from "zod";

import type { Letter } from "@/mail/letter";

/** The slot: the op that sends a letter. The cmd fills it from a mail install. */
const send = tag<Operation.Handle<void, Letter>>({ label: "welcome.send" });

/** A listener: it sends the new member a welcome letter. */
const greet = operation({
  label: "welcome.greet",
  input: z.object({ email: z.string() }),
  depends: { send },
  run: ({ send }, { input }) =>
    send.run({ input: { to: input.email, subject: "Welcome", body: "You are in." } }),
});

/** Welcome letters: `welcome({ send: mailer.send })`. */
export const welcome = capsule({
  label: "welcome",
  config: { send: send.required },
  exports: { greet },
});
