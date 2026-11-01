import { main } from "./hedl/server.js";
import { getRouter } from "./hedl/router.js";

const base = { cwd: "/app", signal: new AbortController().signal, stdout: { write: (c: string) => c } };

// 1. Hedl with no DATABASE_URL: start must fail and name the key.
try {
  await main({ ...base, env: { PUBLIC_ORIGIN: "http://x", AUTH_SECRET: "s" } });
  console.log("1 FAIL: started without a database url");
} catch (error) {
  console.log("1 ok:", (error as Error).message);
}

// 2. Hedl with no AUTH_SECRET.
try {
  await main({ ...base, env: { DATABASE_URL: "file:./data/hedl.db", PUBLIC_ORIGIN: "http://x" } });
  console.log("2 FAIL: started without auth settings");
} catch (error) {
  console.log("2 ok:", (error as Error).message);
}

// 3. Full env, production: the live record of every extension.
const { tools, app } = await main({
  ...base,
  env: { DATABASE_URL: "file:./data/hedl.db", PUBLIC_ORIGIN: "http://x", AUTH_SECRET: "s", NODE_ENV: "production" },
});
console.log("3 tools record:", JSON.stringify(tools.extensions));
console.log("3 app record:", JSON.stringify(app.extensions, null, 1));

// 4. The tab side.
const tab = await getRouter(false);
console.log("4 tab record:", JSON.stringify(tab.extensions.map((e) => e.label)));
