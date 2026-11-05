import { createScope, resource } from "@tinker/core";
import type { ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { expect, test } from "vite-plus/test";

import { Render, ScopeProvider } from "@/index";

const hello = resource({
  label: "hello",
  factory:
    () =>
    (props: { name: string }): ReactNode => <p>{`hello ${props.name}`}</p>,
});

test("a server render draws a renderable resource in one pass", async () => {
  const scope = createScope();

  const html = renderToString(
    <ScopeProvider scope={scope}>
      <Render of={hello} name="ada" />
    </ScopeProvider>,
  );

  expect(html).toBe("<p>hello ada</p>");

  await scope.close();
});
