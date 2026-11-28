import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import { mail } from "@/mail";
import { smtpMail } from "@/mail/smtp.server";
import { signup } from "@/signup";
import { throttler } from "@/throttle/throttler.server";
import { welcome } from "@/welcome";

import { tick } from "./support";

test("step 2: the provider takes one letter per 100 ms, so the third sign-up waits 200 ms", async () => {
  const clock = makeTestClock();
  const pace = throttler({ gapMs: 100 });
  const smtp = smtpMail({ throttle: pace.runner });
  const mailer = mail({ backend: smtp.deliver });
  const greeter = welcome({ send: mailer.send });
  const members = signup({ on: [greeter.greet] });
  const scope = await createScope({
    clock,
    capsules: [exits({ file: process.env.TINKER_EXITS }), pace, smtp, mailer, greeter, members],
  }).ready;
  const done: string[] = [];

  for (const email of ["a@x.io", "b@x.io", "c@x.io"]) {
    void scope.run(members.join, { input: { email } }).then(() => done.push(email));
  }

  await tick(clock, 0);
  expect(done).toEqual(["a@x.io"]);
  await tick(clock, 100);
  expect(done).toEqual(["a@x.io", "b@x.io"]);
  await tick(clock, 100);
  expect(done).toEqual(["a@x.io", "b@x.io", "c@x.io"]);
  await scope.close();
});
