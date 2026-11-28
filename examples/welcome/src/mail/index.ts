import { capsule, operation, tag, type Operation } from "@tinkered/core";

import { letter, type Letter } from "./letter";

/** The slot: the backend's operation that takes a letter. The cmd fills it. */
const backend = tag<Operation.Handle<void, Letter>>({ label: "mail.backend" });

/** What a feature calls to send a mail. It hands the letter to the backend in the slot. */
const send = operation({
  label: "mail.send",
  input: letter,
  depends: { backend },
  run: ({ backend }, { input }) => backend.run({ input }),
});

/** The app's mail capsule: `mail({ backend: someBackend.deliver })` in the cmd. */
export const mail = capsule({
  label: "mail",
  config: { backend: backend.required },
  exports: { send },
});
