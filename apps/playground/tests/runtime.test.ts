// @vitest-environment happy-dom
import { expect, test } from "vite-plus/test";
import { createScope } from "@tinker/core";
import { runtime } from "@/services.ts";
import { statusCell } from "@/state.ts";

const post = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data }));

test("an ok signal from the preview reports ready and keeps the compile time", () => {
  const scope = createScope();
  const status = scope.controller(statusCell);
  status.set({ kind: "info", text: "running…", ms: 12 });
  scope.resolve(runtime);
  post({ __pg: "ok" });
  expect(status.get()).toEqual({ kind: "ok", text: "ready", ms: 12 });
});

test("an error signal from the preview becomes an error status", () => {
  const scope = createScope();
  scope.resolve(runtime);
  post({ __pg: "error", text: "boom is not defined" });
  expect(scope.resolve(statusCell)).toEqual({ kind: "error", text: "boom is not defined" });
});

test("releasing the runtime stops listening; resolving it again listens anew", () => {
  const scope = createScope();
  const status = scope.controller(statusCell);
  scope.resolve(runtime);
  scope.release(runtime);
  post({ __pg: "error", text: "late" });
  expect(status.get()).toEqual({ kind: "info", text: "starting…" });
  scope.resolve(runtime);
  post({ __pg: "ok" });
  expect(status.get()).toEqual({ kind: "ok", text: "ready" });
});
