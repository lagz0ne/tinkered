import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { expect, test } from "vite-plus/test";

import { mail } from "@/mail";
import { outbox } from "@/outbox/index.server";
import { signup } from "@/signup";
import { welcome } from "@/welcome";

import { flakyMail, tick } from "./support";

test("step 3: sign-up answers at once; the pump sends; a dead address ends in dead", async () => {
  const clock = makeTestClock();
  const flaky = flakyMail();
  const queue = outbox({ inner: flaky.deliver, everyMs: 100, tries: 2 });
  const mailer = mail({ backend: queue.enqueue });
  const greeter = welcome({ send: mailer.send });
  const members = signup({ on: [greeter.greet] });
  const scope = await createScope({
    clock,
    capsules: [exits({ file: process.env.TINKER_EXITS }), flaky, queue, mailer, greeter, members],
  }).ready;
  const sent = scope.resolve(flaky.sent);

  await scope.run(members.join, { input: { email: "a@x.io" } });
  await scope.run(members.join, { input: { email: "b@down.io" } });
  expect(sent.get()).toEqual([]);

  await tick(clock, 100);
  expect(sent.get().map((l) => l.to)).toEqual(["a@x.io"]);
  await tick(clock, 100);
  await tick(clock, 100);
  expect(
    scope
      .resolve(queue.dead)
      .get()
      .map((i) => i.letter.to),
  ).toEqual(["b@down.io"]);
  await tick(clock, 100);
  expect(scope.resolve(queue.line).get()).toEqual([]);
  await scope.close();
});
