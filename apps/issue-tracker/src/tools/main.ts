import { command, runMain } from "@tinker/cli";
import { api } from "../client/api.ts";
import { issueCommands, issueTools, serveIssues } from "./issues.ts";

function readBaseUrl(): string {
  const raw = process.env.BASE_URL;
  if (raw !== undefined && raw.length > 0) return raw;
  return "http://127.0.0.1:4311";
}

await runMain({
  name: "issues",
  version: "0.1.0",
  scope: {
    tags: [
      api.config({ baseUrl: readBaseUrl() }),
      ...issueCommands,
      ...issueTools,
      command.entry("mcp", () => serveIssues),
    ],
  },
});
