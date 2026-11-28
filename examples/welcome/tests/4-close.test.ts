import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { mail } from "@/mail";
import { memoryMail } from "@/mail/memory.server";
import { outbox } from "@/outbox/index.server";
import { signup } from "@/signup";
import { welcome } from "@/welcome";

/** Joins two members, closes, and answers who got a letter before the scope ended. */
const joinThenClose = async (graceful: boolean) => {
  const memory = memoryMail();
  const queue = outbox({ inner: memory.deliver, everyMs: 60_000 });
  const mailer = mail({ backend: queue.enqueue });
  const greeter = welcome({ send: mailer.send });
  const members = signup({ on: [greeter.greet] });
  const scope = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), memory, queue, mailer, greeter, members],
  }).ready;
  const sent = scope.resolve(memory.sent);
  let got: string[] = [];
  sent.watch(() => {
    got = sent.get().map((l) => l.to);
  });

  await scope.run(members.join, { input: { email: "a@x.io" } });
  await scope.run(members.join, { input: { email: "b@x.io" } });
  expect(got).toEqual([]);

  await scope.close({ graceful });
  return got;
};

test("step 4: a graceful close sends each letter still in line", async () => {
  expect(await joinThenClose(true)).toEqual(["a@x.io", "b@x.io"]);
});

test("step 4: a forced close drops the line", async () => {
  expect(await joinThenClose(false)).toEqual([]);
});
