import { tag } from "@tinker/core";
import { z } from "zod";
const settings = z.object({
  SUPPLIER_A_URL: z.url(),
  SUPPLIER_B_URL: z.url(),
  SUPPLIER_C_URL: z.url(),
});
/** Parse the fixed process settings.
 * @param env - From the HTTP entry environment; for the three supplier URLs.
 */
export const readFlightSettings = (env: {
  SUPPLIER_A_URL?: string;
  SUPPLIER_B_URL?: string;
  SUPPLIER_C_URL?: string;
}) => settings.parse(env);
export const flightSettings = tag<z.infer<typeof settings>>({ label: "flight.settings" });
