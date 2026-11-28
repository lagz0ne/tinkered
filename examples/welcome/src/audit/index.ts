import { capsule, data, tag, type Operation } from "@tinkered/core";

import type { Letter } from "@/mail/letter";

/** The slot: the send op the audit watches. */
const of = tag<Operation.Handle<void, Letter>>({ label: "audit.of" });

/** Who got which subject, in send order: what an audit page or a test reads. */
const seen = data<string[]>({ label: "audit.seen", initial: [] });

const kept = { role: "state", explain: "Each letter the audit saw" } as const;

/** A wire tap: it sees each run of the op in `of` and lets it go on, unchanged. */
export const audit = capsule({
  label: "audit",
  config: { of: of.required },
  exports: { seen },
  hooks: {
    run(event) {
      if (event.is(event.config.of)) {
        const { to, subject } = event.input;
        const line = `${to}: ${subject}`;
        event.load(seen, kept).update((list) => [...list, line]);
      }
      return event.next();
    },
  },
});
