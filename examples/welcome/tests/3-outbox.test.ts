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
  const scope = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      flakyMail(),
      outbox({ inner: flakyMail.deliver, everyMs: 100, tries: 2 }),
      mail({ backend: outbox.enqueue }),
      welcome(),
      signup({ on: [welcome.greet] }),
    ],
  }).ready;
  const sent = scope.resolve(flakyMail.sent);

  await scope.run(signup.join, { input: { email: "a@x.io" } });
  await scope.run(signup.join, { input: { email: "b@down.io" } });
  expect(sent.get()).toEqual([]);

  await tick(clock, 100);
  expect(sent.get().map((l) => l.to)).toEqual(["a@x.io"]);
  await tick(clock, 100);
  await tick(clock, 100);
  expect(
    scope
      .resolve(outbox.dead)
      .get()
      .map((i) => i.letter.to),
  ).toEqual(["b@down.io"]);
  await tick(clock, 100);
  expect(scope.resolve(outbox.line).get()).toEqual([]);
  await scope.close();
});
