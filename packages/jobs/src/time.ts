import { tag } from "@tinker/core";
import type { Clock } from "pg-boss";

/** Only the test helper binds this clock; production keeps the library's clock. */
export const jobsClock = tag<Clock>({ label: "jobs.clock" });
