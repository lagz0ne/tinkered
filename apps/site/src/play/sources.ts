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
  { name: "@tinkered/core/main.ts", content: coreMain },
  { name: "@tinkered/core/index.ts", content: coreIndex },
  { name: "@tinkered/core/errors.ts", content: coreErrors },
  { name: "@tinkered/core/preset-symbol.ts", content: corePresetSymbol },
  { name: "@tinkered/core/trace-random.ts", content: coreTraceRandom },
  { name: "@tinkered/core/rpc.ts", content: coreRpc },
  { name: "@tinkered/core/rpc-lifecycle.ts", content: coreRpcLifecycle },
  { name: "@tinkered/core/rpc-protocol.ts", content: coreRpcProtocol },
  { name: "@tinkered/core/rpc-request.ts", content: coreRpcRequest },
  { name: "@tinkered/core/rpc-shape.ts", content: coreRpcShape },
  { name: "@tinkered/core/rpc-transport.ts", content: coreRpcTransport },
  { name: "@tinkered/core/rpc-wire.ts", content: coreRpcWire },
  { name: "@tinkered/core/remote-data.ts", content: coreRemoteData },
  { name: "@tinkered/core/memory.ts", content: coreMemory },
  { name: "@tinkered/react/index.ts", content: reactIndex },
  { name: "@tinkered/react/errors.ts", content: reactErrors },
];

/** The bare imports the library answers, and the file each one starts at. */
export const entries: Readonly<Record<string, string>> = {
  "@tinkered/core": "@tinkered/core/main.ts",
  "@tinkered/react": "@tinkered/react/index.ts",
};
