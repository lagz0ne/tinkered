import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { isError, mail } from "../src/index.ts";

test("a missing or bad MAIL_URL fails boot naming the key", async () => {
  for (const MAIL_URL of [
    undefined,
    "bad",
    "http://user:pass@host:587",
    "smtp://host:587",
    "smtp://user@host:587",
    "smtp://:pass@host:587",
    "smtp://user:pass@host:70000",
    "smtp://%ZZ:pass@host:587",
  ]) {
    const piece = mail({}, { env: { MAIL_URL }, from: "team@example.com" });
    const scope = createScope({
      signal: new AbortController().signal,
      extensions: [piece.extension],
    });
    try {
      await scope.ready;
      expect.unreachable();
    } catch (error) {
      if (!isError(error, "InvalidConfig")) throw error;
      expect(error.payload).toEqual({ key: "MAIL_URL" });
    }
    await scope.closed;
  }
});
