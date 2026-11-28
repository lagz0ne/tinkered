import pageCmd from "@examples/welcome/cmds/page.ts?raw";
import server from "@examples/welcome/cmds/server.ts?raw";
import readme from "@examples/welcome/README.md?raw";
import audit from "@examples/welcome/src/audit/index.ts?raw";
import mail from "@examples/welcome/src/mail/index.ts?raw";
import letter from "@examples/welcome/src/mail/letter.ts?raw";
import memory from "@examples/welcome/src/mail/memory.server.ts?raw";
import smtp from "@examples/welcome/src/mail/smtp.server.ts?raw";
import outbox from "@examples/welcome/src/outbox/index.server.ts?raw";
import signup from "@examples/welcome/src/signup/index.ts?raw";
import throttler from "@examples/welcome/src/throttle/throttler.server.ts?raw";
import welcome from "@examples/welcome/src/welcome/index.ts?raw";
import signupTest from "@examples/welcome/tests/1-signup.test.ts?raw";
import throttleTest from "@examples/welcome/tests/2-throttle.test.ts?raw";
import outboxTest from "@examples/welcome/tests/3-outbox.test.ts?raw";
import closeTest from "@examples/welcome/tests/4-close.test.ts?raw";
import auditTest from "@examples/welcome/tests/5-audit.test.ts?raw";
import traceTest from "@examples/welcome/tests/6-trace.test.ts?raw";
import support from "@examples/welcome/tests/support.ts?raw";
import graph from "@examples/welcome/tinker.graph?raw";
import tsconfig from "@examples/welcome/tsconfig.json?raw";
import core from "@pkg/core/package.json?raw";

// examples/welcome as the repo has it, by its path in the project. A test checks that this list
// names each file of the example, so a new file there fails the site's tests until it is here.

/** The example's own files: code, tests, README, graph. */
export const welcomeFiles: Readonly<Record<string, string>> = {
  "README.md": readme,
  "tsconfig.json": tsconfig,
  "tinker.graph": graph,
  "cmds/page.ts": pageCmd,
  "cmds/server.ts": server,
  "src/audit/index.ts": audit,
  "src/mail/index.ts": mail,
  "src/mail/letter.ts": letter,
  "src/mail/memory.server.ts": memory,
  "src/mail/smtp.server.ts": smtp,
  "src/outbox/index.server.ts": outbox,
  "src/signup/index.ts": signup,
  "src/throttle/throttler.server.ts": throttler,
  "src/welcome/index.ts": welcome,
  "tests/1-signup.test.ts": signupTest,
  "tests/2-throttle.test.ts": throttleTest,
  "tests/3-outbox.test.ts": outboxTest,
  "tests/4-close.test.ts": closeTest,
  "tests/5-audit.test.ts": auditTest,
  "tests/6-trace.test.ts": traceTest,
  "tests/support.ts": support,
};

/** Core's package.json: the project asks npm for this minor. */
export const corePackage = core;
