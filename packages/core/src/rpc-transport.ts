// remoteData still runs on middleware (`use`); rpc runs on the lifecycle's hooks. `Entry` is the
// lifecycle's here: a key's `implement` entry takes hooks, not a `use` list.
export { hook, lifecycle } from "./rpc-lifecycle";

export type {
  Context,
  Entry,
  Hooks,
  OnError,
  OnFinish,
  OnStart,
  OnSuccess,
  Outcome,
  RunOptions,
} from "./rpc-lifecycle";

export * from "./rpc-protocol";
export * from "./rpc-wire";
export { request, requestStop, traceparentOf } from "./rpc-request";
