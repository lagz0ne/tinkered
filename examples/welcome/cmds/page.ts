import { createScope, type Observe } from "@tinkered/core";
import { devtools } from "@tinkered/devtools";

import { audit } from "@/audit";
import { mail } from "@/mail";
import { smtpMail } from "@/mail/smtp.server";
import { outbox } from "@/outbox/index.server";
import { signup } from "@/signup";
import { throttler } from "@/throttle/throttler.server";
import { welcome } from "@/welcome";

// The page cmd: the capsules of cmds/server.ts, run in a browser tab. It signs up three members,
// closes gracefully, then draws what the audit saw and each span, by capsule.
// Try: set gapMs to 500, add a member, or drop `trail` from the capsules.

const trace = devtools();
const pace = throttler({ gapMs: 100 });
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

const seen = scope.resolve(trail.seen).get();
const closed = await scope.close({ graceful: true });
const spans = trace.snapshot().runs.filter((s) => s.kind !== "resource");

// Times come from the spans: the scope's clock stamps each start and end.
let first = Infinity;
let joined = 0;
let last = 0;

for (const span of spans) {
  first = Math.min(first, span.start);
  last = Math.max(last, span.end ?? span.start);
  if (span.name === "signup.join") joined = Math.max(joined, span.end ?? span.start);
}

// The span tree, one line per span, two spaces per level: `name [capsule] exit`.
const children = new Map<number | undefined, Observe.Span[]>();

for (const span of spans) {
  children.set(span.parentId, [...(children.get(span.parentId) ?? []), span]);
}

const lines: string[] = [];
const stack: { span: Observe.Span; depth: number }[] = [];

for (const span of [...(children.get(undefined) ?? [])].reverse()) {
  stack.push({ span, depth: 0 });
}

while (stack.length) {
  const top = stack.pop();
  if (!top) break;

  const exit = top.span.attributes["tinker.exit"];
  const where = `[${String(top.span.attributes.capsule ?? "-")}]`;
  lines.push(`${"  ".repeat(top.depth)}${top.span.name} ${where}${exit ? ` ${String(exit)}` : ""}`);

  for (const child of [...(children.get(top.span.id) ?? [])].reverse()) {
    stack.push({ span: child, depth: top.depth + 1 });
  }
}

const sections = [
  ["Sign-up answered", `3 members in ${Math.round(joined - first)} ms`],
  ["The audit saw", seen.join("\n")],
  ["Close", `${closed.status}, the last letter sent at ${Math.round(last - first)} ms`],
  ["Spans, by capsule", lines.join("\n")],
];

const page = document.createElement("main");
page.style.cssText = "padding:16px;max-width:720px";

for (const [title, text] of sections) {
  const head = document.createElement("h3");
  const body = document.createElement("pre");
  head.textContent = title ?? "";
  body.textContent = text ?? "";
  page.append(head, body);
}

document.body.replaceChildren(page);
