import { runMain } from "@tinker/cli";
import { commands } from "./index.ts";

/** The real entrypoint: the blueprint row table, run through the process —
 * argv in, exit code out. */
await runMain({ name: "blueprint", version: "0.0.0", commands });
