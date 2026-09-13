import { failTask } from "./errors.ts";

export declare namespace Tasks {
  /** A copy of a task's current state. IDs are unique within one task list. */
  type Task = { id: string; title: string; done: boolean };

  /** Owns task state and returns copies in the order tasks were added. */
  type Handle = {
    add(title: string): Task;
    complete(id: string): void;
    list(): Task[];
    listDone(): Task[];
  };
}

/** Creates an empty task list. Completion throws TaskNotFound or TaskAlreadyDone. */
export function createTasks(): Tasks.Handle {
  const tasks = new Map<string, Tasks.Task>();

  return {
    add(title) {
      const task: Tasks.Task = { id: String(tasks.size + 1), title, done: false };
      tasks.set(task.id, task);
      return { ...task };
    },
    complete(id) {
      const task = tasks.get(id);
      if (!task) failTask("TaskNotFound", id);
      if (task.done) failTask("TaskAlreadyDone", id);
      task.done = true;
    },
    list() {
      return Array.from(tasks.values(), (task) => ({ ...task }));
    },
    listDone() {
      const done: Tasks.Task[] = [];
      for (const task of tasks.values()) if (task.done) done.push({ ...task });
      return done;
    },
  };
}
