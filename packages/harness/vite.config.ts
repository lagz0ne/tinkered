import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      resolveDepSubpath: true,
      neverBundle: [
        "@tinker/core",
        "@tinker/mcp",
        "@anthropic-ai/claude-agent-sdk",
        "@openai/codex-sdk",
        "zod",
        "@modelcontextprotocol/sdk",
      ],
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },
  fmt: {},
  test: {
    server: { deps: { inline: ["vite-plus"] } },
  },
});
