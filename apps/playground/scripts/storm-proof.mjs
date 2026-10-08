import { execFile } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { createServer } from "node:http";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";

const [beforeInput, afterInput, output, mode = "measure"] = process.argv.slice(2);
const servers = [];
const serve = async (directory, port) => {
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".wasm": "application/wasm",
    ".svg": "image/svg+xml",
  };
  const server = createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const file = join(resolve(directory), path === "/" ? "index.html" : path);
    try {
      const content = readFileSync(file);
      response.writeHead(200, {
        "Content-Type": types[extname(file)] || "application/octet-stream",
      });
      response.end(content);
    } catch {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${port}`;
};
const before = process.argv.includes("--serve") ? await serve(beforeInput, 4427) : beforeInput;
const after = process.argv.includes("--serve") ? await serve(afterInput, 4428) : afterInput;
mkdirSync(output, { recursive: true });
const execute = promisify(execFile);
const browser = async (...args) =>
  (
    await execute("agent-browser", ["--engine", "chrome", "--session", "storm", ...args], {
      encoding: "utf8",
    })
  ).stdout.trim();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const load = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
await browser("open", before);
await browser("set", "viewport", "1280", "900");
const socket = new WebSocket(await browser("get", "cdp-url"));
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = reject;
});
let next = 0;
const pending = new Map();
const listeners = new Set();
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.id) {
    const promise = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) promise.reject(new Error(JSON.stringify(message.error)));
    else promise.resolve(message.result);
  } else for (const listener of listeners) listener(message);
};
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params, sessionId }));
  });
const { targetInfos } = await send("Target.getTargets");
const target = targetInfos.find((item) => item.type === "page" && item.url.startsWith(before));
const { sessionId } = await send("Target.attachToTarget", {
  targetId: target.targetId,
  flatten: true,
});
const page = (method, params) => send(method, params, sessionId);
const evaluate = async (expression) => {
  const result = await page("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
};
await page("Page.enable");
await page("Runtime.enable");

const setup = `(() => {
  const w = document.querySelector('iframe').contentWindow;
  const d = w.document;
  const set = Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype, 'value').set;
  const ranges = [...d.querySelectorAll('input[type=range]')];
  [3, 12, 100].forEach((value, index) => {
    set.call(ranges[index], String(value));
    ranges[index].dispatchEvent(new w.Event('input', { bubbles: true }));
    ranges[index].dispatchEvent(new w.Event('change', { bubbles: true }));
  });
  return ranges.map(input => input.value);
})()`;
const navigate = async (url) => {
  await browser("open", url);
  for (let attempt = 0; attempt < 120; attempt++) {
    if (
      await evaluate(
        "document.querySelector('iframe')?.contentDocument?.querySelectorAll('.tile').length === 144",
      )
    )
      return;
    await sleep(100);
  }
  throw new Error("The game did not render 144 tiles");
};

if (mode === "capture") {
  const { identifier } = await page("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (parent !== window) {
      let time = 1000000, id = 0, seed = 7;
      const callbacks = new Map();
      Date.now = () => time;
      Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
      requestAnimationFrame = callback => { callbacks.set(++id, callback); return id; };
      cancelAnimationFrame = id => callbacks.delete(id);
      window.__stormStep = delta => {
        time += delta;
        const due = [...callbacks.values()];
        callbacks.clear();
        for (const callback of due) callback(time);
      };
    }`,
  });
  const captures = [];
  for (const [side, url] of [
    ["before", before],
    ["after", after],
  ]) {
    for (let turn = 0; turn < 3; turn++) {
      await navigate(url);
      await evaluate(setup);
      for (let step = 0; step < turn; step++) {
        await evaluate(
          "document.querySelector('iframe').contentDocument.querySelector('[aria-label=\"Turn right\"]').click()",
        );
        await evaluate("document.querySelector('iframe').contentWindow.__stormStep(250)");
      }
      await evaluate(`(() => {
        const d = document.querySelector('iframe').contentDocument;
        d.querySelectorAll('.tile')[65].click();
        d.querySelectorAll('.tile')[79].click();
      })()`);
      await evaluate("document.querySelector('iframe').contentWindow.__stormStep(300)");
      await sleep(100);
      const heading = -45 + turn * 90;
      const file = `${side}-${heading}.png`;
      await browser("screenshot", join(output, file));
      captures.push({
        side,
        heading,
        file,
        state: await evaluate(`(() => {
        const d = document.querySelector('iframe').contentDocument;
        return { transform: d.querySelector('.tilt').style.transform,
          walls: d.querySelector('.tilt').dataset.walls,
          tiles: [...d.querySelectorAll('.tile')].map(tile => tile.style.transform) };
      })()`),
      });
    }
  }
  await page("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  writeFileSync(join(output, "captures.json"), JSON.stringify(captures, null, 2));
  const pairs = [-45, 45, 135]
    .map(
      (heading) =>
        `<section><h2>${heading}°</h2><div class="pair">` +
        ["before", "after"]
          .map(
            (side) =>
              `<figure><figcaption>${side}</figcaption><img src="${side}-${heading}.png" alt="${side} at ${heading} degrees"></figure>`,
          )
          .join("") +
        "</div></section>",
    )
    .join("");
  writeFileSync(
    join(output, "index.html"),
    `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Storm walls: before and after</title><style>body{margin:16px;background:#04101f;color:#e6f4f1;font:16px system-ui}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}figure{margin:0}img{width:100%;height:auto}figcaption{padding:8px}@media(max-width:600px){.pair{grid-template-columns:1fr}}</style><h1>Storm walls</h1><p>Same two waves, height, and clock. Real turn controls set each view.</p>${pairs}</html>`,
  );
  console.log(
    JSON.stringify({
      captures: captures.map(({ side, heading, file, state }) => ({
        side,
        heading,
        file,
        transform: state.transform,
        walls: state.walls,
      })),
    }),
  );
} else if (mode === "frames") {
  if (load() >= 4) {
    appendFileSync(
      join(output, "frames.jsonl"),
      JSON.stringify({ before, initialLoad: load(), quiet: false }) + "\n",
    );
    throw new Error("Load must be under 4 for the frame benchmark");
  }
  await navigate(before);
  await evaluate(setup);
  await evaluate(
    "[...document.querySelector('iframe').contentDocument.querySelectorAll('button')].find(button => button.textContent.includes('Start storm')).click()",
  );
  const loads = [load()];
  const sampler = setInterval(() => loads.push(load()), 1000);
  await evaluate(`new Promise(resolve => {
    const w = document.querySelector('iframe').contentWindow;
    let count = 0;
    const frame = () => {
      if (++count === 60) resolve(count);
      else w.requestAnimationFrame(frame);
    };
    w.requestAnimationFrame(frame);
  })`);
  clearInterval(sampler);
  loads.push(load());
  appendFileSync(
    join(output, "frames.jsonl"),
    JSON.stringify({
      before,
      frameCallbacks: 60,
      loads,
      quiet: loads.every((value) => value < 4),
    }) + "\n",
  );
  if (loads.some((value) => value >= 4))
    throw new Error("Load reached 4 during the frame benchmark");
  console.log(JSON.stringify({ frameCallbacks: 60, loads }));
} else {
  const results = [];
  for (let run = 0; run < 3; run++) {
    for (const [side, url] of run % 2
      ? [
          ["after", after],
          ["before", before],
        ]
      : [
          ["before", before],
          ["after", after],
        ]) {
      while (load() >= 4) {
        console.log(JSON.stringify({ waitingForLoadUnder4: load() }));
        await sleep(10000);
      }
      await navigate(url);
      const settings = await evaluate(setup);
      await evaluate(
        "[...document.querySelector('iframe').contentDocument.querySelectorAll('button')].find(button => button.textContent.includes('Start storm')).click()",
      );
      await sleep(2500);
      let layers = [];
      const layerListener = (message) => {
        if (
          message.sessionId === sessionId &&
          message.method === "LayerTree.layerTreeDidChange" &&
          message.params.layers
        )
          layers = message.params.layers;
      };
      listeners.add(layerListener);
      await page("LayerTree.enable");
      await sleep(500);
      const rows = [];
      for (const layer of layers) {
        let element;
        if (layer.backendNodeId) {
          const { node } = await page("DOM.describeNode", { backendNodeId: layer.backendNodeId });
          const attributes = node.attributes || [];
          const classIndex = attributes.indexOf("class");
          element =
            node.nodeName.toLowerCase() +
            (classIndex < 0 ? "" : "." + attributes[classIndex + 1].split(" ").join("."));
        }
        rows.push({
          id: layer.layerId,
          element,
          width: layer.width,
          height: layer.height,
          drawsContent: layer.drawsContent,
        });
      }
      await page("LayerTree.disable");
      listeners.delete(layerListener);
      const events = [];
      let complete;
      const ended = new Promise((resolve) => {
        complete = resolve;
      });
      const traceListener = (message) => {
        if (message.method === "Tracing.dataCollected") events.push(...message.params.value);
        if (message.method === "Tracing.tracingComplete") complete();
      };
      listeners.add(traceListener);
      const loads = [load()];
      await send("Tracing.start", {
        transferMode: "ReportEvents",
        categories:
          "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,benchmark,cc,viz,toplevel",
      });
      const start = await evaluate('console.timeStamp("storm-start"); performance.now()');
      for (let second = 0; second < 10; second++) {
        await sleep(1000);
        loads.push(load());
      }
      const end = await evaluate('console.timeStamp("storm-end"); performance.now()');
      await send("Tracing.end");
      await ended;
      listeners.delete(traceListener);
      writeFileSync(
        join(output, `${side}-${run}.trace.json.gz`),
        gzipSync(JSON.stringify({ traceEvents: events })),
      );
      const traceStart = events.find(
        (event) => event.name === "TimeStamp" && event.args.data?.message === "storm-start",
      ).ts;
      const traceEnd = events.find(
        (event) => event.name === "TimeStamp" && event.args.data?.message === "storm-end",
      ).ts;
      const presented = events.filter(
        (event) =>
          event.name === "AnimationFrame::Presentation" &&
          event.ts >= traceStart &&
          event.ts <= traceEnd,
      );
      if (!presented.length) throw new Error("No presentation events; cannot report frames shown");
      const frameIds = new Set(presented.map((event) => JSON.stringify(event.args.begin_frame_id)));
      const frameProcesses = new Set(presented.map((event) => event.pid));
      const frameThreads = events.filter(
        (event) =>
          event.name === "thread_name" &&
          event.args.name === "CrRendererMain" &&
          frameProcesses.has(event.pid),
      );
      const tasks = events.filter(
        (event) =>
          event.ph === "X" &&
          event.name === "RunTask" &&
          event.dur >= 50000 &&
          event.ts >= traceStart &&
          event.ts <= traceEnd &&
          frameThreads.some((thread) => thread.pid === event.pid && thread.tid === event.tid),
      );
      const duration = (end - start) / 1000;
      const result = {
        side,
        run: run + 1,
        settings,
        durationSeconds: duration,
        loads,
        quiet: loads.every((value) => value < 4),
        presentedFrames: frameIds.size,
        presentedFps: frameIds.size / duration,
        longTasks: tasks.length,
        longTaskBlockingMs: tasks.reduce((sum, task) => sum + task.dur / 1000 - 50, 0),
        layers: {
          count: rows.length,
          arrows: rows.filter((row) => row.element === "span.arrow").length,
          walls: rows.filter((row) => row.element?.startsWith("span.wall.")).length,
          backingBytes: rows
            .filter((row) => row.drawsContent)
            .reduce((sum, row) => sum + row.width * row.height * 4, 0),
          rows,
        },
      };
      await evaluate(
        "[...document.querySelector('iframe').contentDocument.querySelectorAll('button')].find(button => button.textContent.includes('Stop storm')).click()",
      );
      results.push(result);
      console.log(JSON.stringify({ ...result, layers: { ...result.layers, rows: undefined } }));
      writeFileSync(join(output, "measurements.json"), JSON.stringify(results, null, 2));
      if (!result.quiet)
        throw new Error("Load reached 4 during the storm; do not claim fps from this run");
    }
  }
}
socket.close();
await browser("close");
for (const server of servers) await new Promise((resolve) => server.close(resolve));
