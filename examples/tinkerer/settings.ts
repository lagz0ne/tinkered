import { z } from "zod";
import { raise } from "./errors.ts";

const settings = z.object({
  apiKey: z.string().trim().min(1),
  baseUrl: z.url({ protocol: /^https?$/ }),
  model: z.string().trim().min(1),
  prompt: z.string().trim().min(1),
});

/** Validate inputs before opening a root; errors retain field names but never secrets. */
export function readSettings(raw: unknown) {
  const parsed = settings.safeParse(raw);
  if (!parsed.success) {
    raise("InvalidSettings", { fields: parsed.error.issues.map((issue) => issue.path.join(".")) });
  }
  return parsed.data;
}
