import { HttpResponse, type HttpClient } from "@tinker/http";
import type { Tinkerer } from "@tinker/tinkerer";
import { tour, type Tour } from "./real.ts";

const chunks: Tinkerer.Chunk[] = [
  { choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: { content: " from the demo." }, finish_reason: "stop" }] },
  { usage: { prompt_tokens: 10, completion_tokens: 5 } },
];
const stream = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;

/** The public backend tag supplies real HTTP response objects without opening a socket. */
const recorded: HttpClient.Backend = async (request) =>
  HttpResponse.make(request, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: stream,
  });

/** Uses the same turn and stream reader as the live tour, with a local response. */
export function demoTour(): Promise<Tour.Reply[]> {
  return tour(
    {
      apiKey: "demo-key",
      baseUrl: "https://demo.invalid/v1",
      model: "demo-model",
      prompt: "Say hi in five words.",
    },
    recorded,
  );
}

if (import.meta.main) process.stdout.write(`${JSON.stringify(await demoTour(), null, 2)}\n`);
