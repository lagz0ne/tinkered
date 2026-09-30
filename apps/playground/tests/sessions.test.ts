import { createScope } from "@tinker/core";
import { expect, test } from "vite-plus/test";
import {
  beacon,
  draftNotes,
  draftSignal,
  draftTitle,
  editNotes,
  editTitle,
  harbor,
  projectBrief,
} from "../example/sessions/index.ts";

test("resetting a title keeps its notes and the other project draft", async () => {
  const scope = createScope();
  const first = scope.createSession({ ns: harbor }).createSession();
  const other = scope.createSession({ ns: beacon }).createSession();
  first.run(editTitle, { input: "Harbor draft" });
  first.run(editNotes, { input: "Keep this thought" });
  other.run(editTitle, { input: "Beacon draft" });

  first.releaseNs(draftTitle, harbor);

  expect(first.resolve(draftTitle)).toBe("Untitled note");
  expect(first.resolve(draftNotes)).toBe("Keep this thought");
  expect(other.resolve(draftTitle)).toBe("Beacon draft");
  await scope.close();
});

test("a fresh form resets both fields and aborts the old form signal while keeping its brief", async () => {
  const scope = createScope();
  const route = scope.createSession({ ns: harbor });
  const form = route.createSession();
  form.run(editTitle, { input: "Old title" });
  form.run(editNotes, { input: "Old notes" });
  const signal = form.resolve(draftSignal);
  const brief = form.resolve(projectBrief);

  await form.close();
  const fresh = route.createSession();

  expect(fresh.resolve(draftTitle)).toBe("Untitled note");
  expect(fresh.resolve(draftNotes)).toBe("");
  expect(signal.aborted).toBe(true);
  expect(fresh.resolve(draftSignal).aborted).toBe(false);
  expect(fresh.resolve(projectBrief)).toBe(brief);
  await scope.close();
});

test("leaving a route closes its form and returning retains only the project brief", async () => {
  const scope = createScope();
  const route = scope.createSession({ ns: harbor });
  const form = route.createSession();
  const other = scope.createSession({ ns: beacon }).createSession();
  form.run(editNotes, { input: "Gone after leaving" });
  other.run(editNotes, { input: "Beacon stays" });
  const signal = form.resolve(draftSignal);
  const brief = form.resolve(projectBrief);

  await route.close();
  const returned = scope.createSession({ ns: harbor }).createSession();

  expect(signal.aborted).toBe(true);
  expect(returned.resolve(draftNotes)).toBe("");
  expect(returned.resolve(projectBrief)).toBe(brief);
  expect(other.resolve(draftNotes)).toBe("Beacon stays");
  await scope.close();
});

test("refetching a project brief rebuilds only that project and keeps both drafts", async () => {
  const scope = createScope();
  const first = scope.createSession({ ns: harbor }).createSession();
  const other = scope.createSession({ ns: beacon }).createSession();
  first.run(editTitle, { input: "Harbor draft" });
  other.run(editTitle, { input: "Beacon draft" });
  const before = first.resolve(projectBrief);
  const sibling = other.resolve(projectBrief);

  first.releaseNs(projectBrief, harbor);

  expect(first.resolve(projectBrief)).toEqual({ ...before, build: before.build + 1 });
  expect(other.resolve(projectBrief)).toBe(sibling);
  expect(first.resolve(draftTitle)).toBe("Harbor draft");
  expect(other.resolve(draftTitle)).toBe("Beacon draft");
  await scope.close();
});
