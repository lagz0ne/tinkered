import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

export declare namespace Generate {
  type Input = { root: string; name: unknown };
}

/** Writes app-owned files once. The workspace retains its packages and settings.
 * Names are one lowercase directory name; an existing app is never overwritten. */
export async function generate({ root, name }: Generate.Input): Promise<string> {
  if (typeof name !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
    raise("BadAppName", { name });
  }
  const path = join(root, "apps", name);
  await mkdir(join(root, "apps"), { recursive: true });
  await mkdir(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "EEXIST") throw error;
    raise("AppExists", { path });
  });
  const template = fileURLToPath(new URL("../template", import.meta.url));
  const entries = await readdir(template, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = join(entry.parentPath, entry.name);
    const target = join(path, relative(template, source).replace(/\.txt$/, ""));
    await mkdir(dirname(target), { recursive: true });
    const text = await readFile(source, "utf8");
    await writeFile(target, text.replaceAll("__APP_NAME__", name));
  }
  return path;
}
