import assert from "node:assert/strict";
import { connect } from "node:net";
import { createInterface } from "node:readline";

/** Send through the real SMTP port and read the real Mailpit inbox API. */
async function main() {
  const socket = connect(
    Number(process.env.SMTP_PORT ?? 51025),
    process.env.SMTP_HOST ?? "127.0.0.1",
  );
  const lines = createInterface({ input: socket })[Symbol.asyncIterator]();
  async function readReply(code) {
    for (;;) {
      const { value, done } = await lines.next();
      assert.equal(done, false);
      process.stdout.write(`${value}\n`);
      if (value.at(3) === " ") {
        assert.equal(Number(value.slice(0, 3)), code);
        return;
      }
    }
  }
  try {
    await readReply(220);
    for (const command of [
      "EHLO flight-trial",
      "MAIL FROM:<proof@flight.test>",
      "RCPT TO:<inbox@flight.test>",
    ]) {
      socket.write(`${command}\r\n`);
      await readReply(250);
    }
    socket.write("DATA\r\n");
    await readReply(354);
    socket.write(
      "From: proof@flight.test\r\nTo: inbox@flight.test\r\nSubject: Flight service proof\r\n\r\nReal SMTP works.\r\n.\r\n",
    );
    await readReply(250);
    socket.write("QUIT\r\n");
    await readReply(221);
  } finally {
    socket.destroy();
  }
  const response = await fetch(
    `http://${process.env.MAILPIT_HOST ?? "127.0.0.1"}:${process.env.MAILPIT_PORT ?? 58025}/api/v1/messages`,
  );
  assert.equal(response.status, 200);
  const inbox = await response.json();
  assert.ok(inbox.messages.some((mail) => mail.Subject === "Flight service proof"));
  process.stdout.write("Mailpit accepted SMTP and exposed the message in its inbox API.\n");
}

if (import.meta.main) await main();
