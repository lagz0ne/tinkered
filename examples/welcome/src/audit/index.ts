import { capsule, data } from "@tinkered/core";

import { mail } from "@/mail";

/** Who got which subject, in send order: what an audit page or a test reads. */
const seen = data<string[]>({ label: "audit.seen", initial: [] });

const kept = { role: "state", explain: "Each letter the audit saw" } as const;

/** A wire tap: it sees each mail.send run and lets it go on, unchanged. */
export const audit = capsule({
  label: "audit",
  exports: { seen },
  hooks: {
    run(event) {
      if (event.is(mail.send)) {
        const { to, subject } = event.input;
        const line = `${to}: ${subject}`;
        event.load(seen, kept).update((list) => [...list, line]);
      }
      return event.next();
    },
  },
});
