/**
 * A server: a program that listens on a port. Its route table, the request's lifetime and body,
 * outbound HTTP, health, and the shared abort reasons and error payloads.
 */

export { abortReasons } from "@/server/errors";
export type { Errors } from "@/server/errors";
export { baseVersion, health } from "@/server/health";
export { httpBackend } from "@/server/backend";
export { http, httpRequest } from "@/server/http";
export { backendStop, requestStop } from "@/server/lifetime";
export { requestBody } from "@/server/request-body";
export { routes } from "@/server/routes";
export type { Routes } from "@/server/routes";
