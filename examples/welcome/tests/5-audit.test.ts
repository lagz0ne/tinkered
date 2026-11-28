import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { audit } from "@/audit";
import { mail } from "@/mail";
import { memoryMail } from "@/mail/memory.server";
import { signup } from "@/signup";
import { welcome } from "@/welcome";

test("step 5: the audit sees each letter, and no other capsule changed", async () => {
  const memory = memoryMail();
  const mailer = mail({ backend: memory.deliver });
  const greeter = welcome({ send: mailer.send });
  const members = signup({ on: [greeter.greet] });
  const trail = audit({ of: mailer.send });
  const scope = await createScope({
    capsules: [exits({ file: process.env.TINKER_EXITS }), trail, memory, mailer, greeter, members],
  }).ready;

  await scope.run(members.join, { input: { email: "ana@x.io" } });

  expect(scope.resolve(trail.seen).get()).toEqual(["ana@x.io: Welcome"]);
  await scope.close();
});
