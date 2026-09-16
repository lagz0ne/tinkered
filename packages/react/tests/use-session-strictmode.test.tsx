import type { Scope } from "@tinker/core";
import { createScope, resource } from "@tinker/core";
import { StrictMode } from "react";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import { ScopeProvider, SessionProvider, useResource } from "../src/index.ts";

const probe = resource({
  label: "probe",
  target: "session",
  factory: () => ({ ok: true }),
});

function Alive(): React.ReactElement {
  return <p>alive:{String(useResource(probe).ok)}</p>;
}

function countingScope(
  real: Scope.Handle,
  counts: { creates: number; closes: number },
): Scope.Handle {
  return {
    ...real,
    createSession(options?: Scope.Options): Scope.Handle {
      counts.creates += 1;
      const session = real.createSession(options);
      session.onClose(() => {
        counts.closes += 1;
      });
      return session;
    },
  };
}

test("under StrictMode, SessionProvider opens a fresh session per live mount and closes the discarded one", async () => {
  const counts = { creates: 0, closes: 0 };
  const scope = countingScope(createScope(), counts);

  const screen = await render(
    <StrictMode>
      <ScopeProvider scope={scope}>
        <SessionProvider>
          <Alive />
        </SessionProvider>
      </ScopeProvider>
    </StrictMode>,
  );

  await expect.element(screen.getByText("alive:true")).toBeVisible();
  await expect.poll(() => counts.creates).toBe(2);
  await expect.poll(() => counts.creates - counts.closes).toBe(1);

  await screen.unmount();
  await expect.poll(() => counts.creates - counts.closes).toBe(0);

  await scope.close();
});
