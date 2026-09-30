import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tree = process.argv[2] ?? ".";
const mode = process.argv[3] ?? "plain";
const count = Number(process.argv[4] ?? 10000000);
const { createScope, data, extension, operation } = await import(
  pathToFileURL(resolve(tree, "packages/core/dist/index.mjs"))
);
const cell = data({ initial: 1 });
const op = operation({ label: "probe", run: () => 1 });
const hooks = {
  plain: [],
  legacy: [extension({ label: "pass", run: (_op, _call, next) => next() })],
  event: [extension({ label: "pass", hooks: { run: (event) => event.next() } })],
  access: [
    extension({
      label: "read",
      hooks: {
        run: (event) => event.resolve(cell) + event.next() - 1,
      },
    }),
  ],
};
const scope = createScope({ extensions: hooks[mode] });
await scope.ready;
let total = 0;
for (let i = 0; i < count; i++) total += scope.run(op);
await scope.close();
if (total !== count) throw new Error(`Expected ${count}, received ${total}`);
console.log(`completed ${mode}: ${total}`);
