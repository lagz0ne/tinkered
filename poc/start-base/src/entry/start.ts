import { createCsrfMiddleware, createStart } from "@tanstack/react-start";
import { startRequests } from "../start.ts";
export const startInstance = createStart(() => ({
  requestMiddleware: [
    createCsrfMiddleware({ filter: (ctx) => ctx.handlerType === "serverFn" }),
    startRequests.middleware,
  ],
}));
