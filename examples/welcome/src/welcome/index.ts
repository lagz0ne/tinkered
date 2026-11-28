import { capsule, operation } from "@tinkered/core";
import { z } from "zod";

import { mail } from "@/mail";

/** A listener: it sends the new member a welcome letter through the app's mail. */
const greet = operation({
  label: "welcome.greet",
  input: z.object({ email: z.string() }),
  depends: { send: mail.send },
  run: ({ send }, { input }) =>
    send.run({ input: { to: input.email, subject: "Welcome", body: "You are in." } }),
});

export const welcome = capsule({ label: "welcome", exports: { greet } });
