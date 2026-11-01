import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const tree = process.argv[2] ?? ".";
const mode = process.argv[3] ?? "plain";
const count = Number(process.argv[4] ?? 10000000);

const { createScope, data, capsule, extension, operation } = await import(
  pathToFileURL(resolve(tree, "packages/core/dist/index.mjs"))
);

/** A base tree from before ADR 0120 v2 has `extension`; a newer one has `capsule`. */
const declare = capsule ?? extension;
const install = (list) => (capsule ? { capsules: list } : { extensions: list });
const meta = { role: "state", explain: "Reads the probe cell" };
const read = (event) => (capsule ? event.load(cell, meta).get() : event.resolve(cell));

const cell = data({ initial: 1 });
const op = operation({ label: "probe", run: () => 1 });

const hooks = {
  plain: [],
  event: [declare({ label: "pass", hooks: { run: (event) => event.next() } })],
  access: [
    declare({
      label: "read",
      hooks: {
        run: (event) => read(event) + event.next() - 1,
      },
    }),
  ],
};

const scope = createScope(install(hooks[mode]));
await scope.ready;
let total = 0;
for (let i = 0; i < count; i++) total += scope.run(op);
await scope.close();
if (total !== count) throw new Error(`Expected ${count}, received ${total}`);
console.log(`completed ${mode}: ${total}`);
