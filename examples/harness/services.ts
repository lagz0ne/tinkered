import { createScope, namespace, operation, tag, type Namespace } from "@tinker/core";
import { claudeCode, harness, type ClaudeCode } from "@tinker/harness";
import { config, HttpRequest, send } from "@tinker/http";
import { expose } from "@tinker/mcp";
import { z } from "zod";
import { raise } from "./errors.ts";

export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";

const settingsSchema = z.object({
  githubToken: z.string().trim().min(1),
  cloudflareToken: z.string().trim().min(1),
  cwd: z.string().min(1),
});

export declare namespace Services {
  export type Settings = z.output<typeof settingsSchema>;
  export type Routes = { github: Namespace; cloudflare: Namespace };
}

/** Each root chooses the two HTTP namespaces; the reusable graph captures neither key. */
export const serviceRoutes = tag<Services.Routes>({ label: "services.routes" });

const repoFields = { owner: z.string().trim().min(1), repo: z.string().trim().min(1) };
const repoSchema = z.object({
  full_name: z.string(),
  html_url: z.url(),
  private: z.boolean(),
  description: z.string().nullable(),
  stargazers_count: z.number().int().nonnegative(),
});

export const getRepo = operation({
  label: "github.getrepo",
  input: z.object(repoFields),
  depends: { send, routes: serviceRoutes },
  run: async ({ send, routes }, ctx) => {
    const { owner, repo } = ctx.input;
    const response = await send.run({
      ns: routes.github,
      input: HttpRequest.get(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`),
    });
    const result = await response.json(repoSchema);
    return {
      name: result.full_name,
      url: result.html_url,
      private: result.private,
      description: result.description,
      stars: result.stargazers_count,
    };
  },
});

const zoneFields = { name: z.string().trim().min(1).optional() };
const zonesSchema = z.object({
  success: z.literal(true),
  result: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
});

/** Deliberately one page: the tool description tells the agent this is not a full account list. */
export const listZones = operation({
  label: "cloudflare.listzones",
  input: z.object(zoneFields),
  depends: { send, routes: serviceRoutes },
  run: async ({ send, routes }, ctx) => {
    const urlParams: Record<string, string> = { page: "1", per_page: "50" };
    if (ctx.input.name !== undefined) urlParams.name = ctx.input.name;
    const response = await send.run({
      ns: routes.cloudflare,
      input: HttpRequest.get("/zones", { urlParams }),
    });
    const result = await response.json(zonesSchema);
    return { page: 1, zones: result.result };
  },
});

const denyApproval = operation({
  label: "services.denyApproval",
  input: claudeCode.approval,
  run: (): ClaudeCode.Decision => ({ behavior: "deny", message: "Only the two service tools." }),
});

export const services = harness({
  label: "services",
  adapter: claudeCode,
  approve: denyApproval,
  tools: [
    expose(getRepo, {
      name: "getrepo",
      description: "Read one GitHub repository by owner and repo name.",
      schema: repoFields,
    }),
    expose(listZones, {
      name: "listzones",
      description: "Read page 1 of Cloudflare zones, up to 50; optionally filter by name.",
      schema: zoneFields,
    }),
  ],
});

/** Static wiring values only. A namespace selects settings; the caller's root owns the work. */
export function serviceTags(settings: Services.Settings) {
  const github = namespace({
    tags: config({
      baseUrl: "https://api.github.com",
      headers: {
        authorization: `Bearer ${settings.githubToken}`,
        accept: "application/vnd.github+json",
        "x-github-api-version": "2026-03-10",
      },
    }),
  });
  const cloudflare = namespace({
    tags: config({
      baseUrl: "https://api.cloudflare.com/client/v4",
      headers: { authorization: `Bearer ${settings.cloudflareToken}` },
    }),
  });
  return [
    config({ accept: (status) => status >= 200 && status < 300 }),
    serviceRoutes({ github, cloudflare }),
    claudeCode.options({
      cwd: settings.cwd,
      tools: [],
      allowedTools: ["mcp__services__getrepo", "mcp__services__listzones"],
      settingSources: [],
      skills: [],
      strictMcpConfig: true,
    }),
  ];
}

const launchSchema = settingsSchema.extend({ prompts: z.array(z.string().trim().min(1)).min(1) });

/** The process edge validates env and argv once, before opening a root or loading the SDK. */
async function main(): Promise<void> {
  const launch = launchSchema.safeParse({
    githubToken: process.env.GITHUB_TOKEN,
    cloudflareToken: process.env.CLOUDFLARE_API_TOKEN,
    cwd: process.cwd(),
    prompts: process.argv.slice(2),
  });
  if (!launch.success) {
    raise("InvalidSettings", { fields: launch.error.issues.map((issue) => issue.path.join(".")) });
  }
  const stop = new AbortController();
  const root = createScope({ signal: stop.signal, tags: serviceTags(launch.data) });
  await root.ready;
  try {
    const session = root.createSession();
    for (const prompt of launch.data.prompts) {
      const result = await session.run(services.send, { input: { prompt } });
      if (result.subtype === "success") process.stdout.write(`${result.result}\n`);
      else {
        process.stderr.write(`${result.errors.join("\n")}\n`);
        process.exitCode = 1;
      }
    }
  } finally {
    stop.abort();
    await root.closed;
  }
}

if (import.meta.main) await main();
