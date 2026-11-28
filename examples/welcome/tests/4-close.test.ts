import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { mail } from "@/mail";
import { memoryMail } from "@/mail/memory.server";
import { outbox } from "@/outbox/index.server";
import { signup } from "@/signup";
import { welcome } from "@/welcome";

const capsules = () => [
  exits({ file: process.env.TINKER_EXITS }),
  memoryMail(),
  outbox({ inner: memoryMail.deliver, everyMs: 60_000 }),
  mail({ backend: outbox.enqueue }),
  welcome(),
  signup({ on: [welcome.greet] }),
];

/** Joins two members, closes, and answers who got a letter before the scope ended. */
const joinThenClose = async (graceful: boolean) => {
  const scope = await createScope({ capsules: capsules() }).ready;
  const sent = scope.resolve(memoryMail.sent);
  let got: string[] = [];
  sent.watch(() => {
    got = sent.get().map((l) => l.to);
  });

  await scope.run(signup.join, { input: { email: "a@x.io" } });
  await scope.run(signup.join, { input: { email: "b@x.io" } });
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
