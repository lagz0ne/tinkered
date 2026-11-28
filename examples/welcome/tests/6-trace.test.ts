import { exits } from "@tinkered/cli/test";
import { createScope, type Observe } from "@tinkered/core";
import { makeTestClock } from "@tinkered/core/testing";
import { devtools } from "@tinkered/devtools";
import { expect, test } from "vite-plus/test";

import { audit } from "@/audit";
import { mail } from "@/mail";
import { smtpMail } from "@/mail/smtp.server";
import { outbox } from "@/outbox/index.server";
import { signup } from "@/signup";
import { throttler } from "@/throttle/throttler.server";
import { welcome } from "@/welcome";

import { tick } from "./support";

/** One line per span, two spaces per level: `name [capsule] exit`. */
const tree = (spans: readonly Observe.Span[]) => {
  const lines: string[] = [];
  const walk = (parent: number | undefined, depth: number) => {
    for (const span of spans.filter((s) => s.parentId === parent)) {
      const exit = span.attributes["tinker.exit"];
      const where = `[${String(span.attributes.capsule ?? "-")}]`;
      lines.push(`${"  ".repeat(depth)}${span.name} ${where}${exit ? ` ${String(exit)}` : ""}`);
      walk(span.id, depth + 1);
    }
  };
  walk(undefined, 0);
  return lines;
};

test("step 6: devtools shows each span, by capsule", async () => {
  const clock = makeTestClock();
  const trace = devtools();
  const pace = throttler({ gapMs: 100 });
  const smtp = smtpMail({ throttle: pace.runner });
  const queue = outbox({ inner: smtp.deliver, everyMs: 50 });
  const mailer = mail({ backend: queue.enqueue });
  const greeter = welcome({ send: mailer.send });
  const members = signup({ on: [greeter.greet] });
  const trail = audit({ of: mailer.send });
  const scope = await createScope({
    clock,
    capsules: [
      exits({ file: process.env.TINKER_EXITS }),
      trace,
      trail,
      pace,
      smtp,
      queue,
      mailer,
      greeter,
      members,
    ],
  }).ready;

  await scope.run(members.join, { input: { email: "ana@x.io" } });
  await scope.run(members.join, { input: { email: "bo@x.io" } });
  await tick(clock, 50);
  await tick(clock, 100);
  await scope.close({ graceful: true });

  const lines = tree(trace.snapshot().runs.filter((s) => s.kind !== "resource"));
  console.log(lines.join("\n"));
  expect(lines).toContain("signup.join [signup] joined");
  expect(lines).toContain("      outbox.enqueue [outbox]");
  expect(lines).toContain("  outbox.sendOne [-] sent");
});
