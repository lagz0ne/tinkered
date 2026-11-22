/**
 * The rpc stream keys. A call to one keeps its `signal` and `tags` for the stream: its reader
 * outlives the call, so Core opens no child session for them (ADR 0169).
 */
export const streamKeys = new WeakSet<object>();
