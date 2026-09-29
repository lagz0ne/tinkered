import { source, type Sync } from "@tinker/sync";
import { raise } from "../errors.ts";
import { issueList } from "../shared/issues.ts";

const published: Sync.Row[] = [[issueList, "issues"]];

/** The source extension, one identity per process: a root (`main.ts`, a test) installs this
 * same object and the `/sync` row's op declares it in `depends`. */
export const src = source({ cells: published });

/** The keys a tab may ask for: the published rows' keys. */
const keys = new Set(published.map(([, key]) => key));

/** Read the keys a tab's stream URL asks for (`/sync?keys=issues`) as the register sync
 * answers. No key, or a key the source does not publish, raises `BadRegister`. */
export function readRegister(raw: unknown): Sync.Message {
  if (!Array.isArray(raw) || raw.length === 0) raise("BadRegister", { reason: "no keys" });
  const asked = raw.filter((key): key is string => typeof key === "string" && keys.has(key));
  if (asked.length !== raw.length) raise("BadRegister", { reason: "unknown key" });
  return { type: "register", keys: asked };
}
