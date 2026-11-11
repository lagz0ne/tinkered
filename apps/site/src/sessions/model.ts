import { data, namespace, operation, resource, tag } from "@tinker/core";
import { z } from "zod";

// A study in ownership: two projects, each a namespace; each open project a route session; each
// form a child session of its route. Every value has one home, so each reset has one reach.

const projectName = tag<string>({ label: "sessions.project" });

/** One namespace per project: its key outlives the route and the form sessions. */
export const harbor = namespace({ tags: [projectName("Harbor")] });
export const beacon = namespace({ tags: [projectName("Beacon")] });

export const projects = [
  { id: "harbor", name: "Harbor", ns: harbor },
  { id: "beacon", name: "Beacon", ns: beacon },
] as const;

export const openProjects = data({
  label: "sessions.open",
  initial: { harbor: true, beacon: true },
});

/** Leaves a project's route, or comes back to it. */
export const toggleRoute = operation({
  label: "sessions.route.toggle",
  input: z.enum(["harbor", "beacon"]),
  depends: { open: openProjects.controller },
  run: ({ open }, { input }) => open.update((o) => ({ ...o, [input]: !o[input] })),
});

/** The route owns this count; a new value gives React a new child form session. */
export const formGeneration = data({ label: "sessions.form.generation", initial: 0 });

export const resetForm = operation({
  label: "sessions.form.reset",
  depends: { generation: formGeneration.controller },
  run: ({ generation }) => generation.update((n) => n + 1),
});

export const draftTitle = data({ label: "sessions.draft.title", initial: "Untitled note" });
export const draftNotes = data({ label: "sessions.draft.notes", initial: "" });

export const editTitle = operation({
  label: "sessions.draft.title.edit",
  input: z.string(),
  depends: { title: draftTitle.controller },
  run: ({ title }, { input }) => title.set(input),
});

export const editNotes = operation({
  label: "sessions.draft.notes.edit",
  input: z.string(),
  depends: { notes: draftNotes.controller },
  run: ({ notes }, { input }) => notes.set(input),
});

/** Saved per project at the root: it outlives the form and the route. */
export const savedTitle = data<string | null>({ label: "sessions.saved", initial: null });

/** The last save from any project: at the root, outside every namespace. */
export const lastSaved = data<string | null>({ label: "sessions.last", initial: null });

/**
 * The form session runs this op. Each edge names the layer its write lands on (ADR 0126):
 * `atNamespace` is the root, in this project's key; `atScope` is the root, with no key. A plain
 * `controller` here would write the form session and end with it.
 */
export const saveDraft = operation({
  label: "sessions.draft.save",
  depends: {
    title: draftTitle,
    name: projectName.required,
    saved: savedTitle.atNamespace.controller,
    last: lastSaved.atScope.controller,
  },
  run: ({ title, name, saved, last }) => {
    saved.set(title);
    last.set(`${name}: ${title}`);
  },
});

/** A form owns its abort signal. A form reset and a route leave both abort it. */
export const draftSignal = resource({
  label: "sessions.draft.signal",
  target: "session",
  factory: (_, { defer }) => {
    const controller = new AbortController();
    defer(() => controller.abort());
    return controller.signal;
  },
});

const briefBuilds = data({ label: "sessions.brief.builds", initial: 0 });

/** The root keeps one brief per project key. Its build number counts real builds, not reads. */
export const projectBrief = resource({
  label: "sessions.brief",
  target: "namespace",
  depends: { name: projectName.required, builds: briefBuilds.controller },
  factory: ({ name, builds }) => {
    const build = builds.get() + 1;
    builds.set(build);
    return { name, build, text: `A quiet place to shape the next chapter of ${name}.` };
  },
});
