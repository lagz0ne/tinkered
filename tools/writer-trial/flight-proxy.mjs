import { createServer, request as forward } from "node:http";
import { createServer as tcpServer, connect } from "node:net";

/** Only these API paths cross from the writer network to the services network. */
const allowed = {
  supplier: /^\/air\/(offer_requests|offers\/[a-zA-Z0-9_-]+|orders(?:\/[a-zA-Z0-9_-]+)?|payments)$/,
  payment: /^\/v1\/(payment_intents(?:\/[a-zA-Z0-9_-]+(?:\/confirm)?)?|refunds)$/,
};
const servers = [];
for (const [index, name] of ["supplier-a", "supplier-b", "supplier-c", "payment"].entries()) {
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://local").pathname;
    if (!allowed[name === "payment" ? "payment" : "supplier"].test(path)) {
      response.writeHead(403);
      response.end("Teacher controls are private\n");
      return;
    }
    const headers = { ...request.headers };
    delete headers.authorization;
    const upstream = forward(
      {
        hostname: `control-${name}`,
        port: 4310,
        method: request.method,
        path: path + new URL(request.url, "http://local").search,
        headers,
      },
      (reply) => {
        response.writeHead(reply.statusCode, reply.headers);
        reply.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(502);
      response.end();
    });
    request.pipe(upstream);
  });
  server.listen(4311 + index, "supplier-a");
  servers.push(server);
}
process.once("SIGTERM", () => {
  for (const server of servers) server.close();
});
/** Payment sends signed callbacks through this listener; the writer cannot route requests through it. */
const webhook = createServer((request, response) => {
  if (request.method !== "POST" || request.url !== "/webhooks/stripe") {
    response.writeHead(403);
    response.end();
    return;
  }
  const upstream = forward(
    {
      hostname: "app",
      port: 4318,
      path: "/webhooks/stripe",
      method: "POST",
      headers: request.headers,
    },
    (reply) => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on("error", () => {
    response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});
webhook.listen(4300, "service-proxy");
servers.push(webhook);

/** The writer may use the inbox, but only the teacher may change Chaos. */
const inbox = createServer((request, response) => {
  const url = new URL(request.url, "http://local");
  let path;
  try {
    path = decodeURIComponent(url.pathname).replace(/\/+/g, "/");
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  if (path.startsWith("/api/v1/chaos")) {
    response.writeHead(403);
    response.end("Teacher controls are private\n");
    return;
  }
  const upstream = forward(
    {
      hostname: "control-mailpit",
      port: 8025,
      method: request.method,
      path: url.pathname + url.search,
      headers: request.headers,
    },
    (reply) => {
      response.writeHead(reply.statusCode, reply.headers);
      reply.pipe(response);
    },
  );
  upstream.on("error", () => {
    response.writeHead(502);
    response.end();
  });
  request.pipe(upstream);
});
inbox.listen(8025, "mailpit");
servers.push(inbox);
const smtp = tcpServer((socket) => {
  const upstream = connect({ host: "control-mailpit", port: 1025 });
  socket.pipe(upstream).pipe(socket);
  socket.on("error", () => upstream.destroy());
  upstream.on("error", () => socket.destroy());
  socket.on("close", () => upstream.destroy());
  upstream.on("close", () => socket.destroy());
});
smtp.listen(1025, "mailpit");
servers.push(smtp);
