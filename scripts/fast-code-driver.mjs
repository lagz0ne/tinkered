import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const { createScope, data, resource, operation, extension } = await import(
  pathToFileURL(resolve(process.argv[2])).href
);

const cell = data({ label: "fast-code cell", initial: 21 });

const item = resource({
  label: "fast-code resource",
  depends: { cell },
  factory: ({ cell }) => cell * 2,
});

const op = operation({
  label: "fast-code operation",
  depends: { cell },
  run: ({ cell }) => cell + 1,
});

const root = createScope();
root.resolve(item);
const controller = root.controller(op);
const iterations = Number(process.argv[3] ?? 1);
let sum = 0;

for (let i = 0; i < iterations; i++) {
  const result = root.settle(op);
  if (result.status !== "success") throw new Error("Warm operation failed");
  sum += result.value;
  sum += controller.run();
}

const hook = extension({
  label: "fast-code hook",
  hooks: {
    start: (event) => {
      const result = event.settle(op);
      if (result.status !== "success") throw new Error("Hook operation failed");
      return event.next();
    },
    run: (event) => event.next(),
  },
});

const hooked = createScope({ extensions: [hook] });
await hooked.ready;
hooked.run(op);

for (const scope of [root, hooked]) {
  if ((await scope.close({ graceful: true })).status !== "success")
    throw new Error("Warm scope close failed");
}

if (sum !== iterations * 44) throw new Error("Warm loop result changed");
