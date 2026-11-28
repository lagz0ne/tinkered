import { capsule, data, operation } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";

import { letter, type Letter } from "@/mail/letter";

/** Lets each started run reach its next await. */
export const settle = () => new Promise((done) => setTimeout(done, 0));

/** Moves the test clock, with a settle on each side. */
export const tick = async (clock: ReturnType<typeof makeTestClock>, ms: number) => {
  await settle();
  clock.advance(ms);
  await settle();
};

const took = data<Letter[]>({ label: "mail.flaky.sent", initial: [] });

/** A provider that is down for each address at `down.io`. */
const deliver = operation({
  label: "mail.flaky.deliver",
  input: letter,
  depends: { took: took.controller },
  run: ({ took }, { input }) => {
    if (input.to.endsWith("@down.io")) throw new Error(`provider refused ${input.to}`);
    took.update((list) => [...list, input]);
  },
});

/** A test backend that fails for one domain. */
export const flakyMail = capsule({ label: "mail.flaky", exports: { sent: took, deliver } });
