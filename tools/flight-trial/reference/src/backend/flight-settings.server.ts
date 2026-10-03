import { tag } from "@tinker/core";
import { z } from "zod";
export const flightSettingsSchema = z.object({
  SUPPLIER_A_URL: z.url(),
  SUPPLIER_B_URL: z.url(),
  SUPPLIER_C_URL: z.url(),
});
export declare namespace FlightSettings {
  type Environment = {
    SUPPLIER_A_URL?: string;
    SUPPLIER_B_URL?: string;
    SUPPLIER_C_URL?: string;
  };
}
export const flightSettings = tag<z.infer<typeof flightSettingsSchema>>({
  label: "flight.settings",
});
