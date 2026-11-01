// Each line below MUST fail to type-check. tsc reports an unused @ts-expect-error if one passes.

import { extension, operation, tag } from "../core.js";
import { auth, requests, sqlite, sync, telemetry } from "./libs.js";

// 1. A required key left out.
// @ts-expect-error url is required
sqlite({ folder: "/app" });

// 2. A wrong value type.
// @ts-expect-error stop must be an AbortSignal
requests({ stop: "now" });

// 3. A slot filled with the wrong unit type (a string op where a Snapshot op is wanted).
// @ts-expect-error bootstrap must return a Snapshot
sync.server({ bootstrap: operation<string>("x"), readAccount: operation<string | null>("y") });

// 4. An unknown key.
// @ts-expect-error no such key
auth({ settings: undefined, colour: "red" });

// 5. An export with a reserved name.
extension({
  label: "bad",
  // @ts-expect-error label is reserved
  exports: { label: operation<void>("z") },
});

// 6. Calling an extension that has required keys with nothing.
// @ts-expect-error settings is required
auth();

// 7. A tab-side key on the server side.
// @ts-expect-error records belongs to sync.tab
sync.server({ bootstrap: operation("a"), readAccount: operation("b"), records: {} });

// And these MUST pass:
telemetry.app({ ingest: () => {} });
const noConfig = extension({ label: "health" });
noConfig(); // no config: called with nothing
const withDefault = extension({ label: "d", config: { n: tag<number>({ label: "n", default: 1 }) } });
withDefault(); // every key has a default
const exported = sqlite.transaction; // flat export, same object
void exported;
