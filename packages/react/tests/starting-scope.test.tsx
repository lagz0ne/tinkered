import { capsule, createScope, data, operation, type Scope } from "@tinkered/core";
import type { ReactNode } from "react";
import { StrictMode, Suspense, useState } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { ScopeProvider, useData } from "@/index";

import { Catch } from "./support/boundary";
import { deferred } from "./support/deferred";

/** ADR 0128: a root given `capsules` starts; the provider waits for `ready`. */
const opened = data({ label: "store.opened", initial: "closed" });

function Owned({ cell }: { readonly cell: typeof opened }): ReactNode {
  return <p>{`store:${useData(cell)}`}</p>;
}

function Shown(): ReactNode {
  return <p>{`store:${useData(opened)}`}</p>;
}

/** Trap: `useData` mounts here in a Suspense-retry commit, and React subscribes after that commit
 * shows the text. That subscribe takes nothing from a closed scope, but a render after the close
 * raises `Disposed` (ADR 0144 d3). So unmount before closing the scope this test passed in. */
test("the provider shows the Suspense fallback until start ends", async () => {
  const gate = deferred<void>();
  const store = capsule({
    label: "store",
    exports: { opened },
    hooks: {
      async start({ next, load }) {
        await next();
        await gate.promise;
        load(opened, { role: "state", explain: "Opens the store" }).set("open");
      },
    },
  });
  await using scope = createScope({ capsules: [store] });

  const screen = await render(
    <Suspense fallback={<p>starting</p>}>
      <ScopeProvider scope={scope}>
        <Shown />
      </ScopeProvider>
    </Suspense>,
  );
  await expect.element(screen.getByText("starting")).toBeVisible();

  gate.resolve(undefined);
  await expect.element(screen.getByText("store:open")).toBeVisible();
  await screen.unmount();
});

test("a failed start reaches the error boundary", async () => {
  const broken = capsule({
    label: "broken",
    hooks: {
      async start() {
        throw new Error("start failed");
      },
    },
  });
  const scope = createScope({ capsules: [broken] });

  const screen = await render(
    <Catch fallback={(error) => <p>{`caught:${String(error)}`}</p>}>
      <Suspense fallback={<p>starting</p>}>
        <ScopeProvider scope={scope}>
          <Shown />
        </ScopeProvider>
      </Suspense>
    </Catch>,
  );

  await expect.element(screen.getByText("caught:Error: start failed")).toBeVisible();
});

test("a provider that owns a starting root shows its children once started, and closes it on unmount", async () => {
  const gate = deferred<void>();
  /** A cell has one owning capsule, so this store keeps its own. */
  const owned = data({ label: "owned.opened", initial: "closed" });
  const store = capsule({
    label: "owned store",
    exports: { owned },
    hooks: {
      async start({ next, load }) {
        await next();
        await gate.promise;
        load(owned, { role: "state", explain: "Opens the store" }).set("open");
      },
    },
  });
  const ping = operation({ label: "ping", run: () => "pong" });
  const made: Scope.Starting[] = [];

  const screen = await render(
    <StrictMode>
      <Suspense fallback={<p>starting</p>}>
        <ScopeProvider
          create={() => {
            const scope = createScope({ capsules: [store] });
            made.push(scope);
            return scope;
          }}
        >
          <Owned cell={owned} />
        </ScopeProvider>
      </Suspense>
    </StrictMode>,
  );
  gate.resolve(undefined);

  await expect.element(screen.getByText("store:open")).toBeVisible();
  expect(made.length).toBeGreaterThan(0);

  await screen.unmount();

  await Promise.all(made.map(async (scope) => expect(scope.run(ping)).rejects.toThrow("Disposed")));
});

test("a provider that owns a root whose start fails throws to the error boundary", async () => {
  const broken = capsule({
    label: "owned broken",
    hooks: {
      async start() {
        throw new Error("owned start failed");
      },
    },
  });

  const screen = await render(
    <Catch fallback={(error) => <p>{`caught:${String(error)}`}</p>}>
      <ScopeProvider create={() => createScope({ capsules: [broken] })}>
        <Shown />
      </ScopeProvider>
    </Catch>,
  );

  await expect.element(screen.getByText("caught:Error: owned start failed")).toBeVisible();
});

/** Trap: `useData` mounts here in a Suspense-retry commit, and React subscribes after that commit
 * shows the text. That subscribe takes nothing from a closed scope, but a render after the close
 * raises `Disposed` (ADR 0144 d3). So unmount before closing the scope this test passed in. */
test("a new starting root on the provider shows that root's values", async () => {
  const store = capsule({
    label: "swap store",
    hooks: {
      async start({ next }) {
        await next();
      },
    },
  });
  const who = data({ label: "swap.who", initial: "none" });
  const first = createScope({ capsules: [store] });
  const second = createScope({ capsules: [store] });
  (await first.ready).controller(who).set("first");
  (await second.ready).controller(who).set("second");

  function Switcher(): ReactNode {
    const [scope, setScope] = useState<Scope.Starting>(first);
    return (
      <>
        <button type="button" onClick={() => setScope(second)}>
          swap
        </button>
        <Suspense fallback={<p>starting</p>}>
          <ScopeProvider scope={scope}>
            <Owned cell={who} />
          </ScopeProvider>
        </Suspense>
      </>
    );
  }

  const screen = await render(<Switcher />);
  await expect.element(screen.getByText("store:first")).toBeVisible();
  await screen.getByRole("button", { name: "swap" }).click();

  await expect.element(screen.getByText("store:second")).toBeVisible();
  await screen.unmount();
  await first.close();
  await second.close();
});
