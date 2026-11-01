import { capsule } from "@tinker/core";
import { migrate } from "@/lib/tinker.server";
export const setup = capsule({
  label: "backend.setup",
  hooks: {
    async start(event) {
      await event.next();
      await event.run(migrate, {}, { role: "setup", explain: "Brings the schema up to date" });
    },
  },
});
