import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";

/** A proof-only HTTP mirror; a separate process keeps serving during installs and builds. */
const root = resolve(process.argv[2]);
const server = createServer(async (request, response) => {
  const path = resolve(root, "." + new URL(request.url, "http://localhost").pathname);
  if (!path.startsWith(root + sep)) {
    response.writeHead(404).end();
    return;
  }
  try {
    response.setHeader(
      "content-type",
      path.endsWith(".json") ? "application/json" : "application/octet-stream",
    );
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, "127.0.0.1", () => process.send(server.address().port));
process.once("SIGTERM", () => server.close(() => process.exit(0)));
