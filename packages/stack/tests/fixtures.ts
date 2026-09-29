import { once } from "node:events";
import { createServer } from "node:net";
import { expect } from "vite-plus/test";

export async function readFreePort(): Promise<string> {
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  try {
    const address = listener.address();
    if (address === null || typeof address === "string") return expect.unreachable();
    return String(address.port);
  } finally {
    await new Promise<void>((resolve) => listener.close(() => resolve()));
  }
}
