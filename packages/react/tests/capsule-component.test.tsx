import { capsule, createScope, data, isError, operation } from "@tinker/core";
import type { ReactNode } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, SessionProvider, useData, useRun } from "@/index";

import { Catch } from "./support/boundary";

const draft = data({ label: "talk.draft", initial: "" });
const said = data<readonly string[]>({ label: "talk.said", initial: [] });

const type = operation({
  label: "talk.type",
  input: (raw: unknown) => String(raw),
  depends: { draft: draft.controller },
  run: ({ draft }, { input }) => draft.set(input),
});

const say = operation({
  label: "talk.say",
  depends: { draft: draft.controller, said: said.controller },
  run: ({ draft, said }) => {
    said.update((rows) => [...rows, draft.get()]);
    draft.set("");
  },
});

/** A component the capsule exports as is (ADR 0125). It reads the capsule's own cells and ops
 * through the hooks, so it follows the scope or session it is mounted in. */
function Panel(props: { readonly title: string }): ReactNode {
  const text = useData(draft);
  const rows = useData(said);
  const typing = useRun(type);
  const saying = useRun(say);

  return (
    <section>
      <h2>{props.title}</h2>
      <input
        aria-label={`draft ${props.title}`}
        value={text}
        onChange={(e) => typing.run({ rawInput: e.currentTarget.value })}
      />
      <button type="button" onClick={() => saying.run()}>
        say {props.title}
      </button>
      <p>
        {props.title} said:{rows.join(",")}
      </p>
    </section>
  );
}

const talk = capsule({ label: "talk", exports: { said, say, Panel } });

test("a component a capsule exports renders from the handle, bound to the capsule's own cells", async () => {
  const scope = createScope({ capsules: [talk] });
  const screen = await render(
    <ScopeProvider scope={scope}>
      <talk.Panel title="Talk" />
    </ScopeProvider>,
  );

  await screen.getByLabelText("draft Talk").fill("hi");
  await screen.getByText("say Talk").click();

  await expect.element(screen.getByText("Talk said:hi")).toBeVisible();
  expect(scope.controller(said).get()).toEqual(["hi"]);

  await scope.close();
});

test("the exported component keeps each session's data apart", async () => {
  const scope = createScope({ capsules: [talk] });
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider>
        <talk.Panel title="A" />
      </SessionProvider>
      <SessionProvider>
        <talk.Panel title="B" />
      </SessionProvider>
    </ScopeProvider>,
  );

  await screen.getByLabelText("draft A").fill("only a");
  await screen.getByText("say A").click();

  await expect.element(screen.getByText("A said:only a")).toBeVisible();
  await expect.element(screen.getByText("B said:", { exact: true })).toBeVisible();

  await scope.close();
});

test("the exported component raises CapsuleMissing through the exported cell it reads", async () => {
  const scope = createScope();

  const screen = await render(
    <ScopeProvider scope={scope}>
      <Catch fallback={(error) => <p>missing:{String(isError(error, "CapsuleMissing"))}</p>}>
        <talk.Panel title="Talk" />
      </Catch>
    </ScopeProvider>,
  );

  await expect.element(screen.getByText("missing:true")).toBeVisible();

  await scope.close();
});
