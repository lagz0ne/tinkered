import { createServer } from "node:net";
import { once } from "node:events";
import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { fixture, input, readStates, scopes } from "./fixtures.ts";

const received: string[] = [];
let authentication = "";
const smtp = createServer((socket) => {
  socket.setEncoding("utf8");
  socket.write("220 localhost ESMTP\r\n");
  let pending = "";
  let body: string[] | undefined;
  socket.on("data", (data: string) => {
    pending += data;
    while (pending.includes("\r\n")) {
      const end = pending.indexOf("\r\n");
      const line = pending.slice(0, end);
      pending = pending.slice(end + 2);
      if (body) {
        if (line !== ".") {
          body.push(line);
          continue;
        }
        received.push(body.join("\r\n"));
        body = undefined;
        socket.write("250 accepted\r\n");
        continue;
      }
      switch (line.split(" ").at(0)) {
        case "EHLO":
          socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
          break;
        case "AUTH":
          authentication = Buffer.from(line.slice(11), "base64").toString();
          socket.write("235 authenticated\r\n");
          break;
        case "DATA":
          body = [];
          socket.write("354 go ahead\r\n");
          break;
        case "QUIT":
          socket.end("221 bye\r\n");
          break;
        default:
          socket.write("250 ok\r\n");
      }
    }
  });
});

test("MAIL_URL sends over SMTP with its credentials and closes the connection", async () => {
  received.length = 0;
  authentication = "";
  smtp.listen(0, "127.0.0.1");
  await once(smtp, "listening");
  const address = smtp.address();
  if (!address || typeof address === "string") expect.unreachable();
  const { client, clock, sendMail, tags, extensions } = await fixture(undefined, {
    env: { MAIL_URL: `smtp://u%40ser:p%3Ass@127.0.0.1:${address.port}` },
    from: "smtp@example.com",
  });
  const scope = createScope({ tags, extensions });
  scopes.push(scope);
  try {
    await scope.ready;
    await scope.session((s) => s.run(sendMail, { input }));
    await clock.advance(1000);
    await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 0 }]);
    expect(received).toEqual([expect.stringContaining("Hello Ada!")]);
    expect(authentication).toBe("\0u@ser\0p:ss");
  } finally {
    await scope.close({ graceful: true });
    await new Promise<void>((resolve, reject) =>
      smtp.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("an SMTP URL without login boots and sends mail", async () => {
  received.length = 0;
  authentication = "";
  smtp.listen(0, "127.0.0.1");
  await once(smtp, "listening");
  const address = smtp.address();
  if (!address || typeof address === "string") expect.unreachable();
  const { client, clock, sendMail, tags, extensions } = await fixture(undefined, {
    env: { MAIL_URL: `smtp://127.0.0.1:${address.port}` },
    from: "smtp@example.com",
  });
  const scope = createScope({ tags, extensions });
  scopes.push(scope);
  try {
    await scope.ready;
    await scope.session((s) => s.run(sendMail, { input }));
    await clock.advance(1000);
    await expect.poll(() => readStates(client)).toEqual([{ state: "completed", retry_count: 0 }]);
    expect(received).toEqual([expect.stringContaining("Hello Ada!")]);
    expect(authentication).toBe("");
  } finally {
    await scope.close({ graceful: true });
    await new Promise<void>((resolve, reject) =>
      smtp.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test("forced close aborts a mail job waiting on SMTP", async () => {
  const attempting = Promise.withResolvers<void>();
  const disconnected = Promise.withResolvers<void>();
  const server = createServer((socket) => {
    socket.setEncoding("utf8");
    socket.write("220 localhost ESMTP\r\n");
    socket.once("close", disconnected.resolve);
    socket.on("data", (command: string) => {
      if (command.startsWith("EHLO")) socket.write("250-localhost\r\n250 AUTH PLAIN\r\n");
      else if (command.startsWith("AUTH")) socket.write("235 authenticated\r\n");
      else if (command.startsWith("MAIL")) attempting.resolve();
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") expect.unreachable();
  const { client, clock, sendMail, tags, extensions } = await fixture(undefined, {
    env: { MAIL_URL: `smtp://user:pass@127.0.0.1:${address.port}` },
    from: "team@example.com",
  });
  const scope = createScope({ tags, extensions });
  scopes.push(scope);
  await scope.ready;
  await scope.session((s) => s.run(sendMail, { input }));
  const polling = clock.advance(1000);
  try {
    await attempting.promise;
    await scope.close({ graceful: false });
    await polling;
    await disconnected.promise;
    expect(await readStates(client)).toEqual([{ state: "retry", retry_count: 0 }]);
  } finally {
    await scope.close();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
