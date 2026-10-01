import { createServer } from "node:net";
import { once } from "node:events";
import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { fixture, input, readStates, scopes } from "./fixtures.ts";

test("MAIL_URL sends over SMTP with its credentials and closes the connection", async () => {
  const received: string[] = [];
  let authentication = "";
  const server = createServer((socket) => {
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
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
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
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
