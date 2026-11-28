import { capsule, data, operation } from "@tinkered/core";

import { letter, type Letter } from "./letter";

/** Each letter the memory backend took, oldest first. */
const sent = data<Letter[]>({ label: "mail.memory.sent", initial: [] });

/** Keeps the letter: a dev or test backend sends nothing out. */
const deliver = operation({
  label: "mail.memory.deliver",
  input: letter,
  depends: { sent: sent.controller },
  run: ({ sent }, { input }) => {
    sent.update((list) => [...list, input]);
  },
});

/** A backend for dev and tests: `mail({ backend: memoryMail.deliver })`. */
export const memoryMail = capsule({ label: "mail.memory", exports: { sent, deliver } });
