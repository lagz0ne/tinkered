import { testCapsule } from "@tinker/core/testing";
import { expect, expectTypeOf, test } from "vite-plus/test";

import { capsule, createScope, data, operation, tag } from "@/index";

/** ADR 0127: the author ships test tooling as a capsule that only tests install. */

type Api = { readonly verify: (code: string) => Promise<boolean> };
const api = tag<Api>({ label: "auth.api" });
const signedIn = data({ label: "auth.signedIn", initial: false });

const verify = operation({
  label: "auth.verify",
  input: (raw: unknown) => String(raw),
  depends: { api, signedIn: signedIn.controller },
  run: async ({ api, signedIn }, { input }) => signedIn.set(await api.verify(input)),
});

const auth = capsule({
  label: "auth",
  config: { api: api.required },
  exports: { signedIn, verify },
});

/** The author's test card and fake server. */
const TEST_CODE = "424242";
const fakeApi: Api = { verify: async (code) => code === TEST_CODE };

const signIn = operation({
  label: "auth.testing.signIn",
  depends: { verify: auth.verify },
  run: ({ verify }) => verify.run({ input: TEST_CODE }),
});

const authTesting = testCapsule(auth, { exports: { signIn } });

test("a test capsule runs the real ops of the capsule it serves", async () => {
  await using app = createScope({ capsules: [auth({ api: fakeApi }), authTesting] });

  await app.run(authTesting.signIn);
  expect(app.resolve(auth.signedIn).get()).toBe(true);
});

test("its label names the capsule it serves", () => {
  expect(authTesting.label).toBe("auth.testing");
});

test("its exports keep their types", () => {
  expectTypeOf(authTesting.signIn).toEqualTypeOf(signIn);
});

test("without the capsule it serves, its first run fails", async () => {
  await using app = await createScope({ capsules: [authTesting] }).ready;

  expect(() => app.run(authTesting.signIn)).toThrow("CapsuleMissing");
});

test("it takes config like any capsule", async () => {
  const code = tag<string>({ label: "auth.testing.code" });
  const withCode = operation({
    label: "auth.testing.withCode",
    depends: { verify: auth.verify, code },
    run: ({ verify, code }) => verify.run({ input: code }),
  });
  const tooling = testCapsule(auth, { config: { code: code.required }, exports: { withCode } });
  await using app = createScope({
    capsules: [auth({ api: fakeApi }), tooling({ code: "000000" })],
  });

  await app.run(tooling.withCode);
  expect(app.resolve(auth.signedIn).get()).toBe(false);
});
