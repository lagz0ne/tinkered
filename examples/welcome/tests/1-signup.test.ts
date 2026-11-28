import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { mail } from "@/mail";
import { memoryMail } from "@/mail/memory.server";
import { signup } from "@/signup";
import { welcome } from "@/welcome";

test("step 1: a new member gets a welcome letter", async () => {
  const memory = memoryMail();
  const mailer = mail({ backend: memory.deliver });
  const greeter = welcome({ send: mailer.send });
  const members = signup({ on: [greeter.greet] });
  const scope = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), memory, mailer, greeter, members],
  }).ready;

  const answer = await scope.run(members.join, { input: { email: "ana@x.io" } });

  expect(answer).toEqual({ kind: "joined" });
  expect(scope.resolve(memory.sent).get()).toEqual([
    { to: "ana@x.io", subject: "Welcome", body: "You are in." },
  ]);
  await scope.close();
});
