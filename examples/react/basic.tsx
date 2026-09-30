import { createScope, data, operation, resource } from "@tinker/core";
import { Suspense, useState } from "react";
import {
  ScopeProvider,
  SessionProvider,
  useController,
  useData,
  useRelease,
  useRun,
  useResource,
  useSpans,
} from "@tinker/react";

const count = data({ label: "count", initial: 0 });

const profile = resource({
  label: "profile",
  factory: async () => ({ name: "Ada" }),
});

const save = operation({
  label: "save",
  input: (raw) => String(raw),
  run: (_deps, { input }) => Promise.resolve(`saved:${input}`),
});

function Counter(): React.ReactElement {
  const value = useData(count);
  const control = useController(count);
  const release = useRelease();
  return (
    <div>
      <button type="button" onClick={() => control.update((n) => n + 1)}>
        count {value}
      </button>
      <button type="button" onClick={() => release(count)}>
        reset
      </button>
    </div>
  );
}

function ProfileCard(): React.ReactElement {
  return <p>{useResource(profile).name}</p>;
}

function SaveButton(): React.ReactElement {
  const run = useRun(save);
  return (
    <button type="button" onClick={() => run.run({ rawInput: "doc" })}>
      {run.status === "success" ? run.data : "save"}
    </button>
  );
}

function SpanCount(): React.ReactElement {
  const [, refresh] = useState(0);
  const spans = useSpans();
  return (
    <button type="button" onClick={() => refresh((n) => n + 1)}>
      spans: {spans.length}
    </button>
  );
}

/** The provider owns the scope; the mounted view owns the span refresh state. */
export function App(): React.ReactElement {
  return (
    <ScopeProvider create={() => createScope({ observe: { history: 200 } })}>
      <Counter />
      <Suspense fallback={<p>loading…</p>}>
        <ProfileCard />
      </Suspense>
      <SessionProvider>
        <SaveButton />
      </SessionProvider>
      <SpanCount />
    </ScopeProvider>
  );
}
