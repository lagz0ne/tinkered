// The library sources the editor opens read only: Core and React as written, so go to definition
// lands in the real code, not in a declaration file.

import coreErrors from "@pkg/core/src/errors.ts?raw";
import coreIndex from "@pkg/core/src/index.ts?raw";
import coreMain from "@pkg/core/src/main.ts?raw";
import coreMemory from "@pkg/core/src/memory.ts?raw";
import corePresetSymbol from "@pkg/core/src/preset-symbol.ts?raw";
import coreRemoteData from "@pkg/core/src/remote-data.ts?raw";
import coreRpcLifecycle from "@pkg/core/src/rpc-lifecycle.ts?raw";
import coreRpcProtocol from "@pkg/core/src/rpc-protocol.ts?raw";
import coreRpcRequest from "@pkg/core/src/rpc-request.ts?raw";
import coreRpcShape from "@pkg/core/src/rpc-shape.ts?raw";
import coreRpcTransport from "@pkg/core/src/rpc-transport.ts?raw";
import coreRpcWire from "@pkg/core/src/rpc-wire.ts?raw";
import coreRpc from "@pkg/core/src/rpc.ts?raw";
import coreTraceRandom from "@pkg/core/src/trace-random.ts?raw";
import reactErrors from "@pkg/react/src/errors.ts?raw";
import reactIndex from "@pkg/react/src/index.ts?raw";

/** One file the editor can show: a tab of the project, or a library source. */
export type Source = { name: string; content: string };

/** Core and React, by the name the editor shows. */
export const library: readonly Source[] = [
  { name: "@tinker/core/main.ts", content: coreMain },
  { name: "@tinker/core/index.ts", content: coreIndex },
  { name: "@tinker/core/errors.ts", content: coreErrors },
  { name: "@tinker/core/preset-symbol.ts", content: corePresetSymbol },
  { name: "@tinker/core/trace-random.ts", content: coreTraceRandom },
  { name: "@tinker/core/rpc.ts", content: coreRpc },
  { name: "@tinker/core/rpc-lifecycle.ts", content: coreRpcLifecycle },
  { name: "@tinker/core/rpc-protocol.ts", content: coreRpcProtocol },
  { name: "@tinker/core/rpc-request.ts", content: coreRpcRequest },
  { name: "@tinker/core/rpc-shape.ts", content: coreRpcShape },
  { name: "@tinker/core/rpc-transport.ts", content: coreRpcTransport },
  { name: "@tinker/core/rpc-wire.ts", content: coreRpcWire },
  { name: "@tinker/core/remote-data.ts", content: coreRemoteData },
  { name: "@tinker/core/memory.ts", content: coreMemory },
  { name: "@tinker/react/index.ts", content: reactIndex },
  { name: "@tinker/react/errors.ts", content: reactErrors },
];

/** The bare imports the library answers, and the file each one starts at. */
export const entries: Readonly<Record<string, string>> = {
  "@tinker/core": "@tinker/core/main.ts",
  "@tinker/react": "@tinker/react/index.ts",
};
