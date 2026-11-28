import { createScope } from "@tinkered/core";
import { devtools } from "@tinkered/devtools";

import { audit } from "@/audit";
import { mail } from "@/mail";
import { smtpMail } from "@/mail/smtp.server";
import { outbox } from "@/outbox/index.server";
import { signup } from "@/signup";
import { throttler } from "@/throttle/throttler.server";
import { welcome } from "@/welcome";

const trace = devtools();
const pace = throttler({ gapMs: Number(process.env.MAIL_GAP_MS ?? 100) });
const smtp = smtpMail({ throttle: pace.runner });
const queue = outbox({ inner: smtp.deliver, everyMs: 50 });
const mailer = mail({ backend: queue.enqueue });
const greeter = welcome({ send: mailer.send });
const members = signup({ on: [greeter.greet] });
const trail = audit({ of: mailer.send });

const scope = await createScope({
  capsules: [trace, trail, pace, smtp, queue, mailer, greeter, members],
}).ready;

for (const email of ["ana@x.io", "bo@x.io", "cy@x.io"]) {
  await scope.run(members.join, { input: { email } });
}

console.log("audit:", scope.resolve(trail.seen).get());

const result = await scope.close({ graceful: true });
console.log("close:", result.status);
console.log("exits:", trace.snapshot().exits);
