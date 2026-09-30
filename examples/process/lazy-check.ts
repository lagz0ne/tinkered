import { operation } from "@tinker/core";
import { argv, io, jsonLine } from "@tinker/process";
import { check } from "./check.ts";

/** Module caching keeps one command graph across later selections. */
export const lazyCheckCommand = operation({
  label: "lazy-check",
  depends: { argv: argv.required, io: io.required, check },
  run: ({ argv: args, io: out, check: op }) => {
    const [file] = args;
    const value = op.run({ rawInput: file });
    out.write(jsonLine(value) ?? "");
    return 0;
  },
});
