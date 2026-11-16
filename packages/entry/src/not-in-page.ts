/**
 * What a page bundler gets for `@tinkered/entry/cmd` and `/server`: the `browser` export
 * condition points here. It exports nothing, so a page build that names a backend export
 * fails; a page that loads it anyway stops at the first line. Precedent: Next.js
 * `server-only`.
 */

import { raise } from "@/errors";

raise("BackendInPage", {});
