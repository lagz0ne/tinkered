// The package entry: Core's units and scope (./index), and the rpc and remoteData primitives
// (ADR 0130). rpc sits on the units, so it is joined here, after them, and ./index never
// imports it.
export * from "./index";

export { bytes, channel, rpc } from "./rpc";
export type { RpcFault } from "./rpc";
export { remoteData } from "./remote-data";
export type { RemoteFault } from "./remote-data";

/** What a transport package builds on: the protocol, its wire shapes and the lifecycle hooks. */
export * as transport from "./rpc-transport";
