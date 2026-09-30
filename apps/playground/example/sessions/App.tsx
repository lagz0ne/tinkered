import { SessionProvider, useData, useRelease, useResource, useRun } from "@tinker/react";
import { ArrowRight, Code2, CornerDownRight, LogOut, RefreshCw, RotateCcw } from "lucide-react";
import type { ReactElement } from "react";
import {
  draftNotes,
  draftSignal,
  draftTitle,
  editNotes,
  editTitle,
  formGeneration,
  openProjects,
  projectBrief,
  projects,
  resetForm,
  toggleRoute,
} from "./model.ts";
import "./sessions.css";

type Project = (typeof projects)[number];

function Brief({ project }: { project: Project }): ReactElement {
  const brief = useResource(projectBrief, { ns: project.ns, suspense: false });
  return (
    <div className="session-brief">
      <div className="session-brief-heading">
        <span className="session-caption">Project brief</span>
        <span className="session-build" aria-live="polite">
          {brief.data ? `Build ${String(brief.data.build).padStart(2, "0")}` : "Loading"}
        </span>
      </div>
      <p>{brief.data?.text}</p>
      <div className="session-brief-footer">
        <span>Kept across form &amp; route resets</span>
        <button type="button" onClick={brief.refetch} className="session-button session-refetch">
          <RefreshCw size={14} aria-hidden="true" />
          Refetch brief
        </button>
      </div>
    </div>
  );
}

function Draft({ project }: { project: Project }): ReactElement {
  const title = useData(draftTitle);
  const notes = useData(draftNotes);
  const setTitle = useRun(editTitle);
  const setNotes = useRun(editNotes);
  const release = useRelease();
  const signal = useResource(draftSignal);
  return (
    <>
      <Brief project={project} />
      <fieldset className="session-draft">
        <legend className="session-caption">Form session</legend>
        <div className="session-field-heading">
          <label htmlFor={`${project.id}-title`}>Title</label>
          <button
            type="button"
            className="session-button session-field-reset"
            onClick={() => release(draftTitle)}
          >
            <RotateCcw size={14} aria-hidden="true" />
            Reset title
          </button>
        </div>
        <input
          id={`${project.id}-title`}
          value={title}
          onChange={(event) => setTitle.run({ input: event.target.value })}
          autoComplete="off"
          spellCheck={false}
        />
        <label className="session-notes-label" htmlFor={`${project.id}-notes`}>
          Notes
        </label>
        <textarea
          id={`${project.id}-notes`}
          value={notes}
          onChange={(event) => setNotes.run({ input: event.target.value })}
          placeholder="Leave a thought here. Then try a reset."
          rows={3}
        />
        <p className="session-signal">
          <span className="session-status-dot" aria-hidden="true" />
          Draft signal {signal.aborted ? "closed" : "open"}
          <span>Aborted when this form closes</span>
        </p>
      </fieldset>
    </>
  );
}

function Route({ project }: { project: Project }): ReactElement {
  const generation = useData(formGeneration);
  const reset = useRun(resetForm);
  return (
    <>
      <SessionProvider key={generation}>
        <Draft project={project} />
      </SessionProvider>
      <div className="session-form-footer">
        <p>
          Reset both fields.
          <br />
          The project brief stays.
        </p>
        <button
          type="button"
          className="session-button session-primary"
          onClick={() => reset.run()}
        >
          <RotateCcw size={15} aria-hidden="true" />
          Reset form
        </button>
      </div>
    </>
  );
}

function ProjectPanel({ project, index }: { project: Project; index: number }): ReactElement {
  const open = useData(openProjects, (value) => value[project.id]);
  const toggle = useRun(toggleRoute);
  return (
    <section className="session-project" aria-label={`${project.name} project`}>
      <header className="session-project-heading">
        <div>
          <span className="session-caption">0{index + 1} / stable project key</span>
          <h2>
            {project.name}
            <span>.</span>
          </h2>
        </div>
        <button
          type="button"
          className="session-button session-route-button"
          onClick={() => toggle.run({ input: project.id })}
        >
          {open ? (
            <LogOut size={15} aria-hidden="true" />
          ) : (
            <ArrowRight size={15} aria-hidden="true" />
          )}
          {open ? "Leave route" : "Return to route"}
        </button>
      </header>
      <div className="session-route-status">
        <CornerDownRight size={14} aria-hidden="true" />
        <span>Route session</span>
        <span className="session-route-state" data-open={open}>
          {open ? "Open" : "Closed"}
        </span>
      </div>
      {open ? (
        <SessionProvider options={{ ns: project.ns }}>
          <Route project={project} />
        </SessionProvider>
      ) : (
        <div className="session-away" role="status">
          <span className="session-away-mark" aria-hidden="true">
            ↳
          </span>
          <h3>A clean exit.</h3>
          <p>
            The route and its form have closed.
            <br />
            Your project brief is still kept.
          </p>
          <p>Return for a fresh draft with the same brief.</p>
        </div>
      )}
    </section>
  );
}

export function SessionsPage({ onShowSource }: { onShowSource: () => void }): ReactElement {
  return (
    <main className="sessions-page">
      <header className="sessions-intro">
        <div>
          <p className="session-caption">002 / a study in ownership</p>
          <h1>
            Room for
            <br />
            <em>every draft.</em>
          </h1>
        </div>
        <div className="sessions-intro-aside">
          <p>Two projects. A place for each change.</p>
          <p>Edit both drafts, then reset one. The other stays just as you left it.</p>
          <button type="button" className="session-button" onClick={onShowSource}>
            <Code2 size={16} aria-hidden="true" />
            View source
            <ArrowRight size={15} aria-hidden="true" />
          </button>
        </div>
      </header>
      <div className="sessions-rule">
        <span>Field → form → route</span>
        <span>Each reset has a home.</span>
      </div>
      <div className="session-projects">
        {projects.map((project, index) => (
          <ProjectPanel key={project.id} project={project} index={index} />
        ))}
      </div>
      <footer className="sessions-footer">
        <p>
          A session owns a form’s lifetime. A namespace is the project key that keeps its brief
          apart.
        </p>
        <p>Leaving this view closes the open forms. Project briefs stay until the page reloads.</p>
      </footer>
    </main>
  );
}
