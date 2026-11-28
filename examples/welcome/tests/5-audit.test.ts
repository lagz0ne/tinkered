import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { audit } from "@/audit";
import { mail } from "@/mail";
import { memoryMail } from "@/mail/memory.server";
import { signup } from "@/signup";
import { welcome } from "@/welcome";

test("step 5: the audit sees each letter, and no other capsule changed", async () => {
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      audit(),
      memoryMail(),
      mail({ backend: memoryMail.deliver }),
      welcome(),
      signup({ on: [welcome.greet] }),
    ],
  }).ready;

  await scope.run(signup.join, { input: { email: "ana@x.io" } });

  expect(scope.resolve(audit.seen).get()).toEqual(["ana@x.io: Welcome"]);
  await scope.close();
});
