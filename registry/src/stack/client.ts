import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { HonoScope } from "../hono/index.ts";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Extra routes share Hono's request session and error handling. */
export function mountClient(app: Parameters<HonoScope.Serve>[0], dir: string): void {
  app.get("/", async (c) => {
    try {
      return c.html(await readFile(join(dir, "index.html"), "utf8"));
    } catch (error) {
      if (isMissing(error)) return c.text("build the client first: vp run build", 503);
      throw error;
    }
  });
  app.get("/assets/:name", async (c) => {
    const name = c.req.param("name");
    if (name.includes("/") || name.includes("..")) return c.text("bad", 400);
    try {
      const body = await readFile(join(dir, "assets", name));
      const type = name.endsWith(".js")
        ? "text/javascript; charset=utf-8"
        : name.endsWith(".css")
          ? "text/css; charset=utf-8"
          : "application/octet-stream";
      return new Response(body, { headers: { "content-type": type } });
    } catch (error) {
      if (isMissing(error)) return c.text("missing", 404);
      throw error;
    }
  });
}
