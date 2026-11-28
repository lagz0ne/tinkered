import { capsule, data, operation, tag, type Operation } from "@tinkered/core";

import { letter, type Letter } from "./letter";

/** The slot: the op that waits for this provider's next turn. */
const throttle = tag<Operation.Handle<Promise<void>, void>>({ label: "mail.smtp.throttle" });

/** Each letter the wire took: a real backend posts to the provider here. */
const sent = data<Letter[]>({ label: "mail.smtp.sent", initial: [] });

/** Waits for a turn, then sends. */
const deliver = operation({
  label: "mail.smtp.deliver",
  input: letter,
  depends: { throttle, sent: sent.controller },
  run: async ({ throttle, sent }, { input }) => {
    await throttle.run();
    sent.update((list) => [...list, input]);
  },
});

/** An SMTP backend with its pace in a slot: `smtpMail({ throttle: throttler.runner })`. */
export const smtpMail = capsule({
  label: "mail.smtp",
  config: { throttle: throttle.required },
  exports: { deliver, sent },
});
