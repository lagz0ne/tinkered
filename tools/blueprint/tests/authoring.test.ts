import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { preset } from "@tinker/core/testing";
import {
  bodyJudge,
  corpus,
  plainChecks,
  readBlueprint,
  readUnits,
  verify,
  verifyChecks,
  type Blueprint,
} from "../src/index";

const namespaceSource = 'const client = resource({ label: "client", target: "namespace" });';

const namespaceYaml = `- resource:
    name: client
    target: namespace
    promise: one client per key until root close
    why: each service has its own settings
`;

const hooks = `{
    async run(event) {
      if (!event.resolve(managed)) return event.next();
      event.controller(active).update((count) => count + 1);
      await event.resolve(client);
      await event.run(send);
      return event.next();
    },
    close: (event) => {
      event.controller(active).set(0);
      return event.next();
    },
  }`;

const engineSource = `const managed = tag({ label: "managed", default: false });
const active = data({ label: "active", initial: 0 });
const client = resource({ label: "client", target: "session", factory: () => ({}) });
const send = operation({ label: "send", run: () => undefined });
const engine = extension({ label: "engine", hooks: ${hooks} });`;

const engineYaml = `- tag:
    name: managed
    promise: whether the engine controls this key
    why: namespaces select engine control
- data:
    name: active
    promise: the number of managed runs
    why: the engine keeps the count
- resource:
    name: client
    target: session
    promise: one client per session and key
    why: the engine needs the selected client
- operation:
    name: send
    promise: send a message
    why: the engine calls it for a managed run
- extension:
    name: engine
    depends: [managed, active, client, send]
    promise: manage runs under their owner and key
    why: one engine controls each selected instance
    work: check managed; count the run; read client; run send; reset the count on close
`;

test("a namespace resource blueprint verifies against namespace source", () => {
  expect(
    verifyChecks(readBlueprint(namespaceYaml), readUnits(namespaceSource, "client.ts")),
  ).toEqual([]);
});

test("namespace source cannot pass verification as a shared scope resource", () => {
  const graph = readBlueprint(namespaceYaml.replace("target: namespace", "target: scope"));
  expect(verifyChecks(graph, readUnits(namespaceSource, "client.ts"))).toEqual([
    {
      source: "plain",
      check: "targetMismatch",
      node: "client",
      detail: "the file says scope; client.ts:1 declares namespace",
      blocking: true,
    },
  ]);
});

test("an extension writes data through declared direct object-hook access", () => {
  const graph = readBlueprint(engineYaml);
  const units = readUnits(engineSource, "engine.ts");
  expect([...plainChecks(graph), ...verifyChecks(graph, units)]).toEqual([]);
});

test("extension source checks skip dynamic access and nested helper bodies", () => {
  const units = readUnits(
    `const engine = extension({ label: "engine", hooks: {
      run(event) {
        event.controller(active).set(1);
        event.resolve(selectClient());
        event.run(actions.send);
        event[method](dynamic);
        other.controller(unrelated);
        const alias = event;
        alias.resolve(aliased);
        const helper = (event) => event.controller(shadowed);
        function nested(event) { return event.run(inner); }
        return event.next();
      },
      start: prepare,
      ...extraHooks,
    } });`,
    "engine.ts",
  );
  expect(units.map((unit) => unit.depends)).toEqual([["active"]]);
});

test("verify sends an extension's hooks body to the body judge", async () => {
  const seen: (string | undefined)[] = [];
  const recording: Blueprint.Judge = {
    ask: async (state, questions) => {
      if ("kind" in state && state.kind === "extension") seen.push(state.body);
      return Object.fromEntries(
        Object.keys(questions).map((id) => [id, { type: "boolean", probability: 0 }]),
      );
    },
  };
  const scope = createScope({ presets: [preset(bodyJudge, () => recording)] });
  try {
    await scope.run(verify, {
      input: {
        graph: readBlueprint(engineYaml),
        units: readUnits(engineSource, "engine.ts"),
        json: false,
      },
    });
    expect(seen).toEqual([hooks]);
  } finally {
    await scope.close();
  }
});

test("the shipped choices offer extensions and namespace resources", async () => {
  const scope = createScope();
  try {
    const loaded = scope.resolve(corpus);
    const unit = loaded.templates.find((template) => template.id === "unitFits");
    const target = loaded.templates.find((template) => template.id === "target");
    if (unit?.kind !== "choice" || target?.kind !== "choice") expect.unreachable();
    expect(unit.shapes?.extension).toContain("hooks");
    expect(target.choices.namespace).toContain("root");
  } finally {
    await scope.close();
  }
});
