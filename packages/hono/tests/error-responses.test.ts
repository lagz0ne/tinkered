import { expect, test } from "vite-plus/test";
import { createScope, LEVELS, operation, type Observe } from "@tinker/core";
import { HTTPException } from "hono/http-exception";
import { errorResponses, hono, route } from "../src/index.ts";

const missing = operation({
  label: "missing",
  run: (_deps, { raise }) => raise("IssueNotFound", { id: "gone" }),
});

const conflict = Object.assign(new Error("IssueConflict"), {
  kind: "IssueConflict",
  payload: { id: "edited", revision: 3 },
});

const edit = operation({
  label: "edit",
  run: () => {
    throw conflict;
  },
});

const readNumber = operation({
  label: "readNumber",
  input: (raw: unknown) => {
    if (typeof raw !== "number") throw new Error("number required");
    return raw;
  },
  run: (_deps, { input }) => input,
});

test("a status-only error row answers a raised kind with an empty body", async () => {
  const { extension: web } = hono([route.get("/missing", missing)], {
    onError: errorResponses({ IssueNotFound: 404 }),
  });
  const scope = createScope({ extensions: [web] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/missing");
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  } finally {
    await scope.close();
  }
});

test("an error body builder reads a registry payload and answers JSON", async () => {
  const { extension: web } = hono([route.post("/edit", edit)], {
    onError: errorResponses<{ IssueConflict: { id: string; revision: number } }>({
      IssueConflict: {
        status: 409,
        body: (payload) => ({ message: "reload", id: payload.id, revision: payload.revision }),
      },
    }),
  });
  const scope = createScope({ extensions: [web] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/edit", { method: "POST" });
    expect(response.status).toBe(409);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(await response.text()).toBe('{"message":"reload","id":"edited","revision":3}');
  } finally {
    await scope.close();
  }
});

test("an error table can answer a core parse error with text from its payload", async () => {
  const { extension: web } = hono([route.get("/number", readNumber, { input: () => "bad" })], {
    onError: errorResponses<{ DataValidationFailed: { label: string } }>({
      DataValidationFailed: { status: 422, body: (payload) => `${payload.label} needs a number` },
    }),
  });
  const scope = createScope({ extensions: [web] });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/number");
    expect(response.status).toBe(422);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=UTF-8");
    expect(await response.text()).toBe("readNumber needs a number");
  } finally {
    await scope.close();
  }
});

test("an unlisted managed error answers 500 and writes one request failed line to the scope sink", async () => {
  const logs: Observe.Log[] = [];
  const { extension: web } = hono([route.post("/edit", edit)], {
    onError: errorResponses({ IssueNotFound: 404 }),
  });
  const scope = createScope({
    extensions: [web],
    observe: { clock: () => 42, log: (entry) => logs.push(entry) },
  });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/edit", { method: "POST" });
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("internal");
    expect(logs.filter((entry) => entry.message === "request failed")).toEqual([
      {
        time: 42,
        level: LEVELS.error,
        message: "request failed",
        attributes: {
          method: "POST",
          path: "/edit",
          error: "IssueConflict",
          name: "Error",
          kind: "IssueConflict",
          payload: { id: "edited", revision: 3 },
          stack: conflict.stack,
        },
        span: undefined,
      },
    ]);
  } finally {
    await scope.close();
  }
});

test("a hand-mounted panic answers 500 and logs its cause through the scope sink", async () => {
  const logs: Observe.Log[] = [];
  const panic = new Error("outer", { cause: new Error("inner", { cause: "wire lost" }) });
  const { extension: web } = hono([], {
    mount: (app) => {
      app.get("/panic", () => {
        throw panic;
      });
    },
  });
  const scope = createScope({ extensions: [web], observe: { log: (entry) => logs.push(entry) } });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/panic");
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("internal");
    expect(logs).toMatchObject([
      {
        level: LEVELS.error,
        message: "request failed",
        attributes: {
          method: "GET",
          path: "/panic",
          error: "outer",
          name: "Error",
          cause: { error: "inner", name: "Error", cause: { error: "wire lost" } },
        },
      },
    ]);
  } finally {
    await scope.close();
  }
});

test("an HTTPException keeps its status body and headers without a request failed line", async () => {
  const logs: Observe.Log[] = [];
  const denied = operation({
    label: "denied",
    run: () => {
      throw new HTTPException(401, {
        res: new Response("sign in", { status: 401, headers: { "www-authenticate": "Bearer" } }),
      });
    },
  });
  const { extension: web } = hono([route.get("/denied", denied)], {
    onError: errorResponses({ IssueNotFound: 404 }),
  });
  const scope = createScope({ extensions: [web], observe: { log: (entry) => logs.push(entry) } });
  try {
    await scope.ready;
    const response = await scope.resolve(web).request("/denied");
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("sign in");
    expect(response.headers.get("www-authenticate")).toBe("Bearer");
    expect(logs.filter((entry) => entry.message === "request failed")).toEqual([]);
  } finally {
    await scope.close();
  }
});
