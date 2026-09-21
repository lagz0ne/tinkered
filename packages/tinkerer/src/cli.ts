import { command } from "@tinker/cli";
import type { Cli } from "@tinker/cli";
import type { Tinkerer } from "./index.ts";

/** The prompt from argv: the non-flag words joined; empty argv is refused by the turn's own
 * parse (`EmptyPrompt`), which the CLI maps to a usage exit. */
function readPrompt(argv: readonly string[]): string {
  return argv.filter((word) => !word.startsWith("--")).join(" ");
}

/** The final answer to stdout: the assistant text, or an empty line when the model sent none. */
function readReply(reply: Tinkerer.Reply): string {
  return reply.message.content ?? "";
}

/** One CLI row for a frame's turn: `<name> ask "<prompt>"` runs one turn and prints the answer.
 * Model, base URL, key, `cwd`, and `mode` are the scope's config (bound by the composition root);
 * the row reuses the same `turn` operation the library runs everywhere (ADR 0053). */
export function askCommand(
  frame: Pick<Tinkerer.Frame, "turn">,
  opts?: { readonly name?: string; readonly description?: string },
): Cli.Row {
  return command(opts?.name ?? "ask", frame.turn, {
    input: readPrompt,
    respond: readReply,
    description: opts?.description ?? "run one turn and print the answer",
  });
}
