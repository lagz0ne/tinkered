import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";

const run = (args) => execFileSync("docker", args, { encoding: "utf8", timeout: 120000 }).trim();
export const flightNames = ["supplier-a", "supplier-b", "supplier-c", "payment"];
export function flightEnvironment() {
  return {
    HOST: "0.0.0.0",
    PORT: "4318",
    VITEST_MAX_WORKERS: "1",
    PUBLIC_ORIGIN: "http://flight-app:4318",
    AUTH_SECRET: "flight-trial-local-auth-secret-at-least-32-characters",
    DATABASE_URL: "postgres://flight:flight-local-only@postgres:5432/flight",
    SMTP_HOST: "mailpit",
    SMTP_PORT: "1025",
    SMTP_USER: "",
    SMTP_PASSWORD: "",
    SMTP_FROM: "flight@example.com",
    SUPPLIER_A_URL: "http://supplier-a:4311",
    SUPPLIER_B_URL: "http://supplier-b:4312",
    SUPPLIER_C_URL: "http://supplier-c:4313",
    PAYMENT_URL: "http://payment:4314",
    WEBHOOK_SECRET: "flight-local-secret",
    VICTORIA_TRACES_URL: "http://victoria-traces:10428/insert/opentelemetry/v1/traces",
    VICTORIA_LOGS_URL: "http://victoria-logs:9428/insert/jsonline",
    OTEL_SERVICE_NAME: "flight-trial",
  };
}
export const environmentArgs = () =>
  Object.entries(flightEnvironment()).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
export function startFlight(prefix, images) {
  const state = {
    prefix,
    network: `${prefix}-app`,
    controlNetwork: `${prefix}-control`,
    containers: [],
    images,
    token: randomBytes(32).toString("hex"),
  };
  try {
    for (const network of [state.network, state.controlNetwork]) createNetwork(network);
    const start = (suffix, network, aliases, image, args, command = []) => {
      const name = `${prefix}-${suffix}`;
      state.containers.push(name);
      run([
        "run",
        "-d",
        "--name",
        name,
        "--network",
        network,
        ...aliases.flatMap((alias) => ["--network-alias", alias]),
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        ...args,
        image,
        ...command,
      ]);
      return name;
    };
    start("postgres", state.network, ["postgres"], images.postgresImage, [
      "-e",
      "POSTGRES_USER=flight",
      "-e",
      "POSTGRES_PASSWORD=flight-local-only",
      "-e",
      "POSTGRES_DB=flight",
      "--user",
      "postgres",
      "--tmpfs",
      "/var/lib/postgresql/data:rw,nosuid,size=512m,uid=70,gid=70",
      "--tmpfs",
      "/var/run/postgresql:rw,nosuid,size=16m,uid=70,gid=70",
    ]);
    start("mailpit", state.network, ["mailpit"], images.mailpitImage, [
      "-e",
      "MP_ENABLE_CHAOS=true",
      "--read-only",
      "--tmpfs",
      "/tmp:rw,nosuid,size=64m",
    ]);
    const proxy = `${prefix}-proxy`;
    run([
      "create",
      "--name",
      proxy,
      "--network",
      state.controlNetwork,
      "--network-alias",
      "service-proxy",
      "--read-only",
      "--cap-drop",
      "ALL",
      "--security-opt",
      "no-new-privileges",
      images.servicesImage,
      "node",
      "proxy.mjs",
    ]);
    state.containers.push(proxy);
    run([
      "network",
      "connect",
      ...flightNames.flatMap((name) => ["--alias", name]),
      state.network,
      proxy,
    ]);
    run(["start", proxy]);
    for (const name of flightNames)
      start(
        name,
        state.controlNetwork,
        [`control-${name}`],
        images.servicesImage,
        [
          "--read-only",
          "-e",
          "HOST=0.0.0.0",
          "-e",
          "PORT=4310",
          "-e",
          `CONTROL_TOKEN=${state.token}`,
          "-e",
          "WEBHOOK_URL=http://service-proxy:4300/webhooks/stripe",
          "-e",
          "WEBHOOK_SECRET=flight-local-secret",
          "-e",
          "HOLD_MS=60000",
        ],
        ["node", "scripts/service.mjs", name],
      );
    run([
      "exec",
      `${prefix}-postgres`,
      "sh",
      "-c",
      "until pg_isready -U flight -d flight; do sleep 0.1; done",
    ]);
    run([
      "exec",
      proxy,
      "node",
      "--input-type=module",
      "-e",
      `for(const name of ${JSON.stringify(flightNames)}) { let ready=false; const end=Date.now()+60000; while(Date.now()<end) { try {const r=await fetch('http://control-'+name+':4310/control/calls',{headers:{authorization:'Bearer '+process.argv[1]}});if(r.ok){ready=true;break}}catch{} await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error(name+' unavailable'); }`,
      state.token,
    ]);
    return state;
  } catch (error) {
    stopFlight(state);
    throw error;
  }
}
/** Small private subnets avoid consuming Docker's default /16 network pool. */
function createNetwork(name) {
  for (let attempt = 0; attempt < 32; attempt++) {
    const bytes = randomBytes(2);
    const subnet = `10.203.${bytes[0]}.${(bytes[1] % 16) * 16}/28`;
    try {
      run(["network", "create", "--internal", "--subnet", subnet, name]);
      return;
    } catch (error) {
      if (!String(error.stderr).includes("overlap")) throw error;
    }
  }
  throw new Error("No free flight trial subnet after 32 tries");
}

export function stopFlight(state) {
  if (state.containers.length) {
    try {
      run(["rm", "-fv", ...[...state.containers].reverse()]);
    } catch {}
  }
  for (const name of [state.network, state.controlNetwork]) {
    try {
      run(["network", "rm", name]);
    } catch {}
  }
}
export const pinFlightImages = (config) =>
  Object.fromEntries(
    Object.entries(config.flight).map(([name, tag]) => [
      name,
      run(["image", "inspect", tag, "--format", "{{.Id}}"]),
    ]),
  );
