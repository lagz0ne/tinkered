import { useNavigate } from "@tanstack/react-router";

import tideSource from "./tide.ts?raw";

// `/live`: the shared sea in two frames, then what it took. The frames are two tabs: each is its
// own scope with its own socket, as two visitors would be.

/** The one change: the playground's cmd, and the shared one. A `+` line is new. */
const before = `const app = createScope({
  capsules: [
    ocean({ cols: 20, rows: 20, frames: window }),
  ],
});`;

const after = `const app = createScope({
  capsules: [
+   ws.client({ url }),
+   sea.board({ read: ws.client }),
+   sea.api({ remote: ws.client }),
    ocean({ cols: 20, rows: 20, frames: window }),
+   tide({ room }),
  ],
});`;

const server = `sea.board({ serve: true }),
sea.api({ implement: seaOps }),`;

function Code({ text }: { text: string }) {
  return (
    <pre className="diff">
      {text.split("\n").map((line, i) => (
        <span key={i} className={line.startsWith("+") ? "add" : undefined}>
          {line}
        </span>
      ))}
    </pre>
  );
}

function Room({ room }: { room: string }) {
  const navigate = useNavigate();
  return (
    <form
      className="room"
      onSubmit={(event) => {
        event.preventDefault();
        const field = event.currentTarget.elements.namedItem("room") as HTMLInputElement;
        const next = field.value
          .trim()
          .toLowerCase()
          .replaceAll(/[^a-z0-9-]/g, "-")
          .slice(0, 24);
        void navigate({ to: "/live", search: { room: next || "lobby" } });
      }}
    >
      <label>
        Room <input name="room" defaultValue={room} key={room} aria-label="Room name" />
      </label>
      <button type="submit">Go</button>
      <a href={`/sea.html?room=${room}`} target="_blank" rel="noreferrer">
        Open this room in a new tab
      </a>
    </form>
  );
}

/** `/live?room=…`: two tabs on one room, the cmd that made them, and the capsule that did it. */
export function LivePage({ room }: { room: string }) {
  const src = `/sea.html?room=${room}`;
  return (
    <main className="page live">
      <header className="head">
        <p className="kicker">Live</p>
        <h1>One sea, every tab</h1>
        <p className="lede">
          The playground's ocean, shared. Press or drag on the water in either frame. The wave rolls
          in both, and in every tab open on room <b>{room}</b>.
        </p>
      </header>
      <div className="frames">
        <figure>
          <figcaption>Tab A</figcaption>
          <iframe src={src} title="Tab A" />
        </figure>
        <figure>
          <figcaption>Tab B</figcaption>
          <iframe src={src} title="Tab B" />
        </figure>
      </div>
      <Room room={room} />
      <section className="grid-row">
        <h2>
          <span>01</span> What changed
        </h2>
        <div className="pair">
          <div>
            <h3>Playground, main.tsx</h3>
            <Code text={before} />
          </div>
          <div>
            <h3>Live, cmds/sea.tsx</h3>
            <Code text={after} />
          </div>
        </div>
        <p>The server adds two capsules, and the socket serves them:</p>
        <Code text={server} />
      </section>
      <section className="grid-row">
        <h2>
          <span>02</span> What did not change
        </h2>
        <ul className="zero">
          <li>
            <code>App.tsx</code>, <code>Scene.tsx</code>: no component knows the sea is shared.
          </li>
          <li>
            <code>engine.ts</code>, <code>state.ts</code>: press, storm and paint are the same ops.
          </li>
          <li>No fetch, no socket code, no effect, no cache in the page.</li>
        </ul>
      </section>
      <section className="grid-row">
        <h2>
          <span>03</span> The tide capsule
        </h2>
        <ol className="why">
          <li>
            Its <code>run</code> hook wraps one move, as Koa middleware wraps a request. A{" "}
            <code>press</code> runs here first, so the wave starts on the touch. Then the hook calls{" "}
            <code>wave.press</code> (an optimistic update, as in TanStack Query). The storm presses
            through it too.
          </li>
          <li>
            The server is the only writer. Each tab reads its room as keyed remote data, so a wave
            goes only to the tabs in that room.
          </li>
          <li>
            Time stays with each scope. Another tab's wave starts when this tab sees it, so a slow
            link never makes a wave jump. This tab's own echo does not land again.
          </li>
          <li>
            The test runs two tabs and a server over a real socket, with no mocks:{" "}
            <code>tests/sea.test.ts</code>.
          </li>
        </ol>
        <Code text={tideSource.trim()} />
      </section>
    </main>
  );
}
