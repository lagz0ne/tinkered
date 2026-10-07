import type { Operation, Resource, Scope } from "@tinker/core";
import { createScope, data, namespace, operation, resource } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import { render } from "vitest-browser-react";
import {
  ScopeProvider,
  SessionProvider,
  useController,
  useData,
  useRelease,
  useResource,
  useRun,
  useScope,
} from "../src/index";

const project = namespace();
const title = data({ label: "form-title", initial: "new" });
const note = data({ label: "form-note", initial: "blank" });
const idle = operation({ label: "idle", run: () => Promise.resolve() });

type Snapshot = {
  owner: Scope.Handle;
  control: Scope.DataController<string>;
  reset: ReturnType<typeof useRelease>;
  refetch: () => void;
  value: object;
};

type FormProps = {
  life: Resource.Handle<object>;
  work: Operation.Handle<Promise<void>, void>;
  seen: Snapshot[];
};

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}): React.ReactElement {
  return (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.currentTarget.value)}
    />
  );
}

function Form({ life, work, seen }: FormProps): React.ReactElement {
  const [value, setValue] = useData(title, { writable: true });
  const [other, setOther] = useData(note, { writable: true });
  const reset = useRelease();
  const live = useResource(life);
  const query = useResource(life, { ns: project, suspense: false });
  const run = useRun(work);
  const owner = useScope();
  const control = useController(title);
  seen.push({ owner, control, reset, refetch: query.refetch, value: live });
  return (
    <div>
      <Field label="title" value={value} onChange={setValue} />
      <Field label="note" value={other} onChange={setOther} />
      <button type="button" onClick={() => reset(title)}>
        reset field
      </button>
      <button type="button" onClick={() => run.run()}>
        work
      </button>
      <p>work:{run.status}</p>
    </div>
  );
}

function Route({
  life,
  form,
  revision,
}: {
  life: Resource.Handle<object>;
  form: FormProps;
  revision: number;
}): React.ReactElement {
  useResource(life);
  return (
    <SessionProvider key={revision}>
      <Form {...form} />
    </SessionProvider>
  );
}

test("a field reset keeps the form owner, other fields, and hook identities", async () => {
  const scope = createScope();
  const life = resource({ label: "field-form", target: "session", factory: () => ({}) });
  const seen: Snapshot[] = [];
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: project }}>
        <Form life={life} work={idle} seen={seen} />
      </SessionProvider>
    </ScopeProvider>,
  );
  const [before] = seen;
  await screen.getByRole("textbox", { name: "title" }).fill("changed");
  await screen.getByRole("textbox", { name: "note" }).fill("kept");
  await screen.getByRole("button", { name: "reset field" }).click();
  await expect.element(screen.getByRole("textbox", { name: "title" })).toHaveValue("new");
  await expect.element(screen.getByRole("textbox", { name: "note" })).toHaveValue("kept");
  const [after] = seen.slice(-1);
  expect(after.owner).toBe(before.owner);
  expect(after.control).toBe(before.control);
  expect(after.reset).toBe(before.reset);
  expect(after.refetch).toBe(before.refetch);
  expect(after.value).toBe(before.value);
  await scope.close();
});

test("a keyed form reset cancels its work and keeps the route alive", async () => {
  const ended: string[] = [];
  const scope = createScope();
  const route = resource({
    label: "form-route",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        ended.push("route");
      });
      return {};
    },
  });
  const life = resource({
    label: "reset-form",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        ended.push("form");
      });
      return {};
    },
  });
  let aborted = false;
  const work = operation({
    label: "form-work",
    run: (_deps, { signal }) =>
      new Promise<void>((resolve) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted = true;
            resolve();
          },
          { once: true },
        );
      }),
  });
  const seen: Snapshot[] = [];
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: project }}>
        <Route life={route} form={{ life, work, seen }} revision={1} />
      </SessionProvider>
    </ScopeProvider>,
  );
  const [before] = seen;
  await screen.getByRole("textbox", { name: "title" }).fill("changed");
  await screen.getByRole("button", { name: "work" }).click();
  await expect.element(screen.getByText("work:pending")).toBeVisible();
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: project }}>
        <Route life={route} form={{ life, work, seen }} revision={2} />
      </SessionProvider>
    </ScopeProvider>,
  );
  await expect.element(screen.getByRole("textbox", { name: "title" })).toHaveValue("new");
  await expect.poll(() => ended).toEqual(["form"]);
  expect(aborted).toBe(true);
  const [after] = seen.slice(-1);
  expect(after.owner).not.toBe(before.owner);
  expect(after.value).not.toBe(before.value);
  await scope.close();
});

test("leaving a route cleans its form and returning reuses the project key", async () => {
  const ended: string[] = [];
  const scope = createScope();
  const cache = resource({ label: "route-cache", target: "namespace", factory: () => ({}) });
  const retained = scope.resolve(cache, { ns: project });
  const route = resource({
    label: "leaving-route",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        ended.push("route");
      });
      return {};
    },
  });
  const life = resource({
    label: "leaving-form",
    target: "session",
    factory: (_deps, { defer }) => {
      defer(() => {
        ended.push("form");
      });
      return {};
    },
  });
  const seen: Snapshot[] = [];
  const screen = await render(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: project }}>
        <Route life={route} form={{ life, work: idle, seen }} revision={1} />
      </SessionProvider>
    </ScopeProvider>,
  );
  const [before] = seen;
  await screen.getByRole("textbox", { name: "title" }).fill("discarded");
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <p>away</p>
    </ScopeProvider>,
  );
  await expect.poll(() => ended).toEqual(["form", "route"]);
  await screen.rerender(
    <ScopeProvider scope={scope}>
      <SessionProvider options={{ ns: project }}>
        <Route life={route} form={{ life, work: idle, seen }} revision={1} />
      </SessionProvider>
    </ScopeProvider>,
  );
  await expect.element(screen.getByRole("textbox", { name: "title" })).toHaveValue("new");
  const [after] = seen.slice(-1);
  expect(after.value).not.toBe(before.value);
  expect(scope.resolve(cache, { ns: project })).toBe(retained);
  await scope.close();
});
