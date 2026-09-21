import { operation } from "@tinker/core";
import type { Scope } from "@tinker/core";
import { argv, io, type Process } from "@tinker/process";
import type { Tinkerer } from "./index.ts";

/** The prompt from argv: the words that are not a `--flag` or a flag's value. */
function readPrompt(args: readonly string[]): string {
  return args
    .filter((word, at) => !word.startsWith("--") && args[at - 1]?.startsWith("--") !== true)
    .join(" ");
}

/** One route for a frame's turn: `<app> ask "<prompt>"` runs one turn, writes the reply through
 * `io` as it streams, and answers its own exit code (ADR 0056). Model, base URL, key, `cwd`, and
 * `mode` are root config — bound by the composition root, or per run in `options`. */
export function askCommand(
  frame: Pick<Tinkerer.Frame, "turn" | "text">,
  opts?: {
    readonly name?: string;
    readonly description?: string;
    readonly options?: Scope.Options;
  },
): Process.Route {
  const name = opts?.name ?? "ask";
  const op = operation({
    label: name,
    depends: {
      argv: argv.required,
      io: io.required,
      text: frame.text.controller,
      turn: frame.turn,
    },
    run: async ({ argv: args, io: out, text, turn }) => {
      const prompt = readPrompt(args);
      if (prompt === "") {
        out.error(`usage: ${name} <prompt>\n`);
        return 2;
      }
      const stop = text.watch((next, previous) => out.write(next.slice(previous.length)));
      try {
        const reply = await turn.run({ input: prompt });
        out.write("\n");
        return reply.finish === "stop" ? 0 : 3;
      } finally {
        stop();
      }
    },
  });
  return {
    name,
    description: opts?.description ?? "run one turn and print the answer as it streams",
    entry: () => ({ op, options: opts?.options }),
  };
}
