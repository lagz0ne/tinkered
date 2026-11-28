import { createScope } from "@tinkered/core";
import { devtools } from "@tinkered/devtools";

import { audit } from "@/audit";
import { mail } from "@/mail";
import { smtpMail } from "@/mail/smtp.server";
import { outbox } from "@/outbox/index.server";
import { signup } from "@/signup";
import { throttler } from "@/throttle/throttler.server";
import { welcome } from "@/welcome";

const dt = devtools();

const scope = await createScope({
  capsules: [
    dt,
    audit(),
    throttler({ gapMs: Number(process.env.MAIL_GAP_MS ?? 100) }),
    smtpMail({ throttle: throttler.runner }),
    outbox({ inner: smtpMail.deliver, everyMs: 50 }),
    mail({ backend: outbox.enqueue }),
    welcome(),
    signup({ on: [welcome.greet] }),
  ],
}).ready;

for (const email of ["ana@x.io", "bo@x.io", "cy@x.io"]) {
  await scope.run(signup.join, { input: { email } });
}

console.log("audit:", scope.resolve(audit.seen).get());

const result = await scope.close({ graceful: true });
console.log("close:", result.status);
console.log("exits:", dt.snapshot().exits);
