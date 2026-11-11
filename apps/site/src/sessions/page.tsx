import { Link } from "@tanstack/react-router";
import { SessionProvider, useData, useRelease, useResource, useRun } from "@tinker/react";

import {
  draftNotes,
  draftSignal,
  draftTitle,
  editNotes,
  editTitle,
  formGeneration,
  lastSaved,
  openProjects,
  projectBrief,
  projects,
  resetForm,
  saveDraft,
  savedTitle,
  toggleRoute,
} from "./model";

// The page: two projects side by side. Each reset reaches only the layer that owns the value.

type Project = (typeof projects)[number];

function Brief({ project }: { project: Project }) {
  const brief = useResource(projectBrief, { ns: project.ns, suspense: false });
  return (
    <div className="brief">
      <p className="layer">
        Namespace · project brief <b>{brief.data ? `build ${brief.data.build}` : "loading"}</b>
      </p>
      <p>{brief.data?.text}</p>
      <button type="button" onClick={brief.refetch}>
        Refetch brief
      </button>
    </div>
  );
}

function Draft({ project }: { project: Project }) {
  const title = useData(draftTitle);
  const notes = useData(draftNotes);
  const setTitle = useRun(editTitle);
  const setNotes = useRun(editNotes);
  const save = useRun(saveDraft);
  const release = useRelease();
  const signal = useResource(draftSignal);

  return (
    <>
      <Brief project={project} />
      <fieldset className="form">
        <legend className="layer">Form session</legend>
        <label htmlFor={`${project.id}-title`}>Title</label>
        <div className="row">
          <input
            id={`${project.id}-title`}
            value={title}
            onChange={(e) => setTitle.run({ input: e.target.value })}
            autoComplete="off"
          />
          <button type="button" onClick={() => release(draftTitle)}>
            Reset title
          </button>
        </div>
        <label htmlFor={`${project.id}-notes`}>Notes</label>
        <textarea
          id={`${project.id}-notes`}
          value={notes}
          onChange={(e) => setNotes.run({ input: e.target.value })}
          placeholder="Leave a thought here. Then try a reset."
          rows={3}
        />
        <p className="layer">
          Draft signal <b>{signal.aborted ? "closed" : "open"}</b>: it aborts when this form closes.
        </p>
        <button type="button" onClick={() => save.run()}>
          Save title
        </button>
      </fieldset>
    </>
  );
}

function Route({ project }: { project: Project }) {
  const generation = useData(formGeneration);
  const saved = useData(savedTitle);
  const reset = useRun(resetForm);
  return (
    <>
      <p className="layer">
        Saved at the root <b>{saved ?? "nothing yet"}</b>
      </p>
      <SessionProvider key={generation}>
        <Draft project={project} />
      </SessionProvider>
      <button type="button" className="strong" onClick={() => reset.run()}>
        Reset form: both fields go, the brief stays
      </button>
    </>
  );
}

function ProjectPanel({ project }: { project: Project }) {
  const open = useData(openProjects, (o) => o[project.id]);
  const toggle = useRun(toggleRoute);
  return (
    <section className="project" aria-label={`${project.name} project`}>
      <header>
        <h2>{project.name}</h2>
        <button type="button" onClick={() => toggle.run({ input: project.id })}>
          {open ? "Leave route" : "Return to route"}
        </button>
      </header>
      <p className="layer">
        Route session <b>{open ? "open" : "closed"}</b>
      </p>
      {open ? (
        <SessionProvider options={{ ns: project.ns }}>
          <Route project={project} />
        </SessionProvider>
      ) : (
        <p role="status">
          The route and its form closed. The project brief is still kept. Come back for a fresh
          draft with the same brief.
        </p>
      )}
    </section>
  );
}

/** `/sessions`: who owns what, shown by what each reset clears. */
export function SessionsPage() {
  const last = useData(lastSaved);
  return (
    <main className="sessions">
      <h1>Room for every draft</h1>
      <p className="lede">
        Two projects. Edit both drafts, then reset one: the other stays as you left it.
      </p>
      <p className="layer">
        Field → form → route → namespace · last save <b>{last ?? "none"}</b>
      </p>
      <div className="projects">
        {projects.map((p) => (
          <ProjectPanel key={p.id} project={p} />
        ))}
      </div>
      <ul className="notes">
        <li>A session owns a form's life. A namespace is the project key that keeps its brief.</li>
        <li>
          Save writes from the form session to the root: per project through{" "}
          <code>atNamespace</code>, and the last save through <code>atScope</code>.
        </li>
        <li>
          Read how:{" "}
          <Link to="/guide/$slug" params={{ slug: "data" }}>
            data
          </Link>{" "}
          and{" "}
          <Link to="/guide/$slug" params={{ slug: "react" }}>
            React
          </Link>
          .
        </li>
      </ul>
    </main>
  );
}
