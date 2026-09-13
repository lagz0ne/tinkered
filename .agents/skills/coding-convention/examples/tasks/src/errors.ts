type TaskErrorName = "TaskNotFound" | "TaskAlreadyDone";

class TaskError<Name extends TaskErrorName> extends Error {
  constructor(
    public name: Name,
    public payload: { id: string },
  ) {
    super(`${name}: ${payload.id}`);
  }
}

export function failTask(name: TaskErrorName, id: string): never {
  throw new TaskError(name, { id });
}

/** Narrows a task error by name and exposes its task ID in payload.id. */
export function isError<Name extends TaskErrorName>(
  error: unknown,
  name: Name,
): error is TaskError<Name> {
  return error instanceof TaskError && error.name === name;
}
