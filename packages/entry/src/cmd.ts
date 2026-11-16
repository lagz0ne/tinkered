/**
 * A command: a program with no port. Its main, the host that runs it, and the panic hook a
 * server command adds.
 */

export { defineMain } from "@/cmd/main";
export type { MainClosed, MainContext, MainStarted } from "@/cmd/main";
export { createMainHost, runMain } from "@/cmd/main-host";
export type { MainHost } from "@/cmd/main-host";
export { observeServerPanics } from "@/cmd/panics";
