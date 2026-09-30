import { data, namespace, operation, resource, tag } from "@tinker/core";
import { raise } from "../../src/errors.ts";

const projectName = tag<string>({ label: "project-name" });

/** Keys stay stable when their route and form sessions end. */
export const harbor = namespace({ tags: [projectName("Harbor")] });
export const beacon = namespace({ tags: [projectName("Beacon")] });

export const projects = [
  { id: "harbor", name: "Harbor", ns: harbor },
  { id: "beacon", name: "Beacon", ns: beacon },
] as const;

export const openProjects = data({
  label: "open-projects",
  initial: { harbor: true, beacon: true },
});

export const toggleRoute = operation({
  label: "toggle-project-route",
  input: (raw): "harbor" | "beacon" =>
    raw === "harbor" || raw === "beacon"
      ? raw
      : raise("InvalidInput", { operation: "toggleRoute", reason: "unknown project" }),
  depends: { open: openProjects.controller },
  run: ({ open }, { input }) => open.update((value) => ({ ...value, [input]: !value[input] })),
});

/** The route owns this cell; changing it gives React a new child form session. */
export const formGeneration = data({ label: "form-generation", initial: 0 });
export const resetForm = operation({
  label: "reset-project-form",
  depends: { generation: formGeneration.controller },
  run: ({ generation }) => generation.update((value) => value + 1),
});

export const draftTitle = data({ label: "draft-title", initial: "Untitled note" });
export const draftNotes = data({ label: "draft-notes", initial: "" });

function readText(raw: unknown): string {
  return typeof raw === "string"
    ? raw
    : raise("InvalidInput", { operation: "editDraft", reason: "expected text" });
}

export const editTitle = operation({
  label: "edit-draft-title",
  input: readText,
  depends: { title: draftTitle.controller },
  run: ({ title }, { input }) => title.set(input),
});

export const editNotes = operation({
  label: "edit-draft-notes",
  input: readText,
  depends: { notes: draftNotes.controller },
  run: ({ notes }, { input }) => notes.set(input),
});

/** A form owns its abort signal. Both form reset and route leave run this cleanup. */
export const draftSignal = resource({
  label: "draft-signal",
  target: "session",
  factory: (_, { defer }) => {
    const controller = new AbortController();
    defer(() => controller.abort());
    return controller.signal;
  },
});

const briefBuilds = data({ label: "brief-builds", initial: 0 });

/** The root retains one brief per key. Its build number counts real local builds, not requests. */
export const projectBrief = resource({
  label: "project-brief",
  target: "namespace",
  depends: { name: projectName.required, builds: briefBuilds.controller },
  factory: ({ name, builds }) => {
    const build = builds.get() + 1;
    builds.set(build);
    return { name, build, text: `A quiet place to shape the next chapter of ${name}.` };
  },
});
