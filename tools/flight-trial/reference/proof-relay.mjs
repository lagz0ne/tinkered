import { createServer } from "node:net";
import { spawn } from "node:child_process";
/** The rebuilt workspace reaches real proof containers through Docker exec, with no host or network changes. */
const mailHost = process.env.FLIGHT_PROOF_MAIL_HOST ?? "mailpit";
const servers = [];
const children = new Set();
for (const { port, host, target } of [
  { port: 55432, host: "127.0.0.1", target: 5432 },
  { port: 51025, host: mailHost, target: 1025 },
  { port: 58025, host: mailHost, target: 8025 },
]) {
  const server = createServer((socket) => {
    const child = spawn(
      "docker",
      ["exec", "-i", "flight-rounds-proof-postgres-1", "nc", host, String(target)],
      { stdio: ["pipe", "pipe", "inherit"] },
    );
    children.add(child);
    socket.pipe(child.stdin);
    child.stdout.pipe(socket);
    child.stdin.on("error", () => socket.destroy());
    socket.on("error", () => child.kill());
    socket.on("close", () => child.kill());
    child.on("exit", () => {
      children.delete(child);
      socket.destroy();
    });
  });
  server.listen(port, "127.0.0.1");
  servers.push(server);
}
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    for (const server of servers) server.close();
    for (const child of children) child.kill();
  });
