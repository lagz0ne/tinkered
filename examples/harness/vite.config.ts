import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: { options: { typeAware: true, typeCheck: true } },
  fmt: {},
  run: {
    tasks: {
      claude: { command: "node --experimental-strip-types real.ts", cache: false },
      codex: { command: "node --experimental-strip-types codex.ts", cache: false },
      tools: { command: "node --experimental-strip-types tools.ts", cache: false },
      approvals: { command: "node --experimental-strip-types approvals.ts", cache: false },
      services: { command: "node --experimental-strip-types services.ts", cache: false },
    },
  },
  test: { include: ["*.test.ts"] },
});
