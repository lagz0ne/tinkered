import { expect, test } from "vite-plus/test";
import { createTasks, isError } from "../src/index.ts";

test("adds tasks and lists them in order", () => {
  const tasks = createTasks();
  const first = tasks.add("Buy milk");
  const second = tasks.add("Buy milk");

  expect(first).toEqual({ id: expect.any(String), title: "Buy milk", done: false });
  expect(second.id).not.toBe(first.id);
  expect(tasks.list()).toEqual([first, second]);
});

test("lists only completed tasks", () => {
  const tasks = createTasks();
  const task = tasks.add("Buy milk");
  tasks.add("Walk dog");
  tasks.complete(task.id);

  expect(tasks.listDone()).toEqual([{ ...task, done: true }]);
});

test("fails with a typed error when the task is missing", () => {
  const tasks = createTasks();
  tasks.add("Buy milk");

  expect.assertions(1);
  try {
    tasks.complete("missing");
  } catch (error) {
    if (!isError(error, "TaskNotFound")) throw error;
    expect(error.payload.id).toBe("missing");
  }
});

test("fails with a typed error when the task is already done", () => {
  const tasks = createTasks();
  const task = tasks.add("Buy milk");
  tasks.complete(task.id);

  expect.assertions(1);
  try {
    tasks.complete(task.id);
  } catch (error) {
    if (isError(error, "TaskNotFound")) throw error;
    if (!isError(error, "TaskAlreadyDone")) throw error;
    expect(error.payload.id).toBe(task.id);
  }
});

test("keeps stored tasks safe from changes to returned copies", () => {
  const tasks = createTasks();
  const task = tasks.add("Buy milk");
  const original = { ...task };
  task.title = "Changed";
  for (const listed of tasks.list()) listed.done = true;
  expect(tasks.list()).toEqual([original]);

  tasks.complete(task.id);
  for (const listed of tasks.listDone()) listed.done = false;
  expect(tasks.list()).toEqual([{ ...original, done: true }]);
});
