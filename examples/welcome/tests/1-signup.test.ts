import { exits } from "@tinkered/cli/test";
import { createScope } from "@tinkered/core";
import { expect, test } from "vite-plus/test";

import { mail } from "@/mail";
import { memoryMail } from "@/mail/memory.server";
import { signup } from "@/signup";
import { welcome } from "@/welcome";

test("step 1: a new member gets a welcome letter", async () => {
  const scope = await createScope({
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      memoryMail(),
      mail({ backend: memoryMail.deliver }),
      welcome(),
      signup({ on: [welcome.greet] }),
    ],
  }).ready;

  const answer = await scope.run(signup.join, { input: { email: "ana@x.io" } });

  expect(answer).toEqual({ kind: "joined" });
  expect(scope.resolve(memoryMail.sent).get()).toEqual([
    { to: "ana@x.io", subject: "Welcome", body: "You are in." },
  ]);
  await scope.close();
});
