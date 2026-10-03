import { tag } from "@tinker/core";
import { z } from "zod";
const settings = z.object({
  SUPPLIER_A_URL: z.url(),
  SUPPLIER_B_URL: z.url(),
  SUPPLIER_C_URL: z.url(),
});
export const readFlightSettings = (env: NodeJS.ProcessEnv) => settings.parse(env);
export const flightSettings = tag<z.infer<typeof settings>>({ label: "flight.settings" });
