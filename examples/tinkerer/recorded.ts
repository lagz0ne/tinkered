import { HttpResponse, type HttpClient } from "@tinker/http";
import type { Tinkerer } from "@tinker/tinkerer";

const chunks: Tinkerer.Chunk[] = [
  { choices: [{ delta: { content: "Hello" } }] },
  { choices: [{ delta: { content: " from the demo." }, finish_reason: "stop" }] },
  { usage: { prompt_tokens: 10, completion_tokens: 5 } },
];
const stream = `${chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("")}data: [DONE]\n\n`;

/** The public backend tag supplies real HTTP response objects without opening a socket. */
export const recorded: HttpClient.Backend = async (request) =>
  HttpResponse.make(request, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
    body: stream,
  });
