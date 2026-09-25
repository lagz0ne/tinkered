import { createServer } from "vite-plus";

await import("./check.mjs");
const root = process.argv[2];
const round = process.argv[3];
const server = await createServer({
  root,
  cacheDir: "/tmp/teacher-browser-cache",
  optimizeDeps: {
    include: ["react", "react-dom/client", "react/jsx-runtime", "@tinker/core", "@tinker/react"],
  },
  configFile: false,
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  logLevel: "silent",
});
try {
  await server.listen();
  process.argv[2] = round;
  await import("./browser.mjs");
} finally {
  await server.close();
}
