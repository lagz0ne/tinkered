import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
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
const socketDirectory = resolve(mkdtempSync(join(output, "browser-")));
const execute = promisify(execFile);
const browser = async (...args) =>
  (
    await execute("agent-browser", ["--engine", "chrome", "--session", "storm", ...args], {
      encoding: "utf8",
      env: { ...process.env, AGENT_BROWSER_SOCKET_DIR: socketDirectory },
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

if (mode === "capture" || mode === "walls") {
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
    for (let turn = 0; turn < 4; turn++) {
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
      const palette = await evaluate(`(() => {
        const d = document.querySelector('iframe').contentDocument;
        return [...d.querySelectorAll('.tile')].map(tile => Object.fromEntries(
          [...tile.querySelectorAll('.wall')].map(wall => [
            ['n','s','w','e'].find(face => wall.classList.contains(face)), wall.style.background])));
      })()`);
      await browser("screenshot", join(output, file));
      if (mode === "walls") {
        await evaluate(`(() => {
          const d = document.querySelector('iframe').contentDocument;
          [...d.querySelectorAll('.tile')].forEach((tile, k) => {
            [...tile.querySelectorAll('.wall')].forEach((wall) => {
              const id = k * 4 + ['n','s','w','e'].findIndex(face => wall.classList.contains(face));
              wall.style.background = 'rgb(' + [id % 9, Math.floor(id / 9) % 9, Math.floor(id / 81)].map(n => 27 + n * 28).join(' ') + ')';
            });
          });
        })()`);
        await browser("screenshot", join(output, `${side}-${heading}-walls.png`));
        for (const colour of ["white", "black"]) {
          await evaluate(
            `document.querySelector('iframe').contentDocument.querySelectorAll('.wall').forEach(wall => wall.style.background = '${colour}')`,
          );
          await browser("screenshot", join(output, `${side}-${heading}-${colour}.png`));
        }
      }
      captures.push({
        side,
        heading,
        file,
        palette,
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
  const gallery = await serve(output, 4429);
  await browser("open", gallery);
  await browser("screenshot", join(output, "pairs.png"), "--full");
  if (mode === "walls") {
    const report = await evaluate(`(async () => {
      const read = async name => {
        const image = new Image();
        image.src = name;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width; canvas.height = image.height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        return context.getImageData(0, 0, image.width, image.height);
      };
      const identify = (tag, white, black, x, y) => {
        const decode = (x, y) => {
          const p = (y * tag.width + x) * 4;
          const alpha = (white.data[p] - black.data[p]) / 255;
          if (alpha < 0.12) return 0;
          const cube = [0,1,2].map(c => Math.round(((tag.data[p+c] - black.data[p+c]) / alpha - 27) / 28));
          if (cube.some(n => n < 0 || n > 8)) return 0;
          const id = cube[0] + cube[1] * 9 + cube[2] * 81 + 1;
          return id <= 576 ? id : 0;
        };
        const id = decode(x,y);
        if (!id) return 0;
        let minimum = 255, maximum = 0;
        for (let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          if (decode(x+dx,y+dy) !== id) return 0;
          const p = ((y+dy) * tag.width + x+dx) * 4;
          const coverage = white.data[p] - black.data[p];
          minimum = Math.min(minimum,coverage); maximum = Math.max(maximum,coverage);
        }
        if (maximum - minimum > 24) return 0;
        return id;
      };
      const rows = [];
      for (const heading of [-45, 45, 135, 225]) {
        const [before, after, beforeMask, afterMask, beforeWhite, afterWhite, beforeBlack, afterBlack] = await Promise.all([
          read('before-' + heading + '.png'), read('after-' + heading + '.png'),
          read('before-' + heading + '-walls.png'), read('after-' + heading + '-walls.png'),
          read('before-' + heading + '-white.png'), read('after-' + heading + '-white.png'),
          read('before-' + heading + '-black.png'), read('after-' + heading + '-black.png')
        ]);
        const tiles = Array.from({length:144}, (_, tile) => ({tile, faces:
          Object.fromEntries(['n','s','w','e'].map(face => [face, {
            beforePixels:0, afterPixels:0, beforeFadedPixels:0, afterFadedPixels:0, regionPixels:0, changedPixels:0,
            changedOver10:0, maxChannelChange:0, commonPixels:0,
            beforeRgb:[0,0,0], afterRgb:[0,0,0]
          }]))}));
        const canvas = document.createElement('canvas');
        canvas.width = before.width; canvas.height = before.height;
        const context = canvas.getContext('2d');
        const diff = context.createImageData(before.width, before.height);
        let changedPixels = 0;
        for (let y = 0; y < before.height; y++) for (let x = 0; x < before.width; x++) {
          const p = (y * before.width + x) * 4;
          const change = Math.max(...[0,1,2].map(c => Math.abs(before.data[p+c] - after.data[p+c])));
          if (change) changedPixels++;
          const gray = (before.data[p] + before.data[p+1] + before.data[p+2]) / 6;
          diff.data.set(change ? [255,40,60,255] : [gray,gray,gray,255], p);
          if (!x || !y || x === before.width-1 || y === before.height-1) continue;
          const a = identify(beforeMask,beforeWhite,beforeBlack,x,y), b = identify(afterMask,afterWhite,afterBlack,x,y);
          for (const id of new Set([a,b])) {
            if (!id) continue;
            const face = tiles[Math.floor((id-1)/4)].faces[['n','s','w','e'][(id-1)%4]];
            face.beforePixels += a === id; face.afterPixels += b === id;
            face.beforeFadedPixels += a === id && beforeWhite.data[p]-beforeBlack.data[p] < 255;
            face.afterFadedPixels += b === id && afterWhite.data[p]-afterBlack.data[p] < 255;
            face.regionPixels++;
            face.changedPixels += change > 0; face.changedOver10 += change > 10;
            face.maxChannelChange = Math.max(face.maxChannelChange,change);
            if (a === id && b === id) {
              face.commonPixels++;
              for (let c=0;c<3;c++) {
                face.beforeRgb[c] += before.data[p+c]; face.afterRgb[c] += after.data[p+c];
              }
            }
          }
        }
        for (const tile of tiles) for (const face of Object.values(tile.faces)) {
          if (face.commonPixels) {
            face.beforeRgb = face.beforeRgb.map(c => c/face.commonPixels);
            face.afterRgb = face.afterRgb.map(c => c/face.commonPixels);
          }
        }
        context.putImageData(diff,0,0);
        rows.push({heading,changedPixels,tiles,diff:canvas.toDataURL('image/png')});
      }
      return rows;
    })()`);
    for (const row of report) {
      writeFileSync(
        join(output, `diff-${row.heading}.png`),
        Buffer.from(row.diff.split(",")[1], "base64"),
      );
      delete row.diff;
    }
    writeFileSync(join(output, "wall-regions.json"), JSON.stringify(report, null, 2));
    process.exitCode = report.some((row) =>
      row.tiles.some((tile) => Object.values(tile.faces).some((face) => face.changedPixels > 0)),
    )
      ? 1
      : 0;
    console.log(
      JSON.stringify({
        walls: report.map((row) => ({
          heading: row.heading,
          faces: Object.fromEntries(
            ["n", "s", "w", "e"].map((face) => [
              face,
              row.tiles.reduce((total, tile) => total + tile.faces[face].beforePixels, 0),
            ]),
          ),
          wallChangesOver10: row.tiles.reduce(
            (sum, tile) =>
              sum + Object.values(tile.faces).reduce((n, face) => n + face.changedOver10, 0),
            0,
          ),
        })),
      }),
    );
  }
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
  await page("Page.addScriptToEvaluateOnNewDocument", {
    source: `if (parent !== window) {
      let seed = 7;
      Math.random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    }`,
  });
  const saved = join(output, "measurements.json");
  const results =
    process.argv.includes("--resume") && existsSync(saved)
      ? JSON.parse(readFileSync(saved, "utf8"))
      : [];
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
      if (results.some((result) => result.side === side && result.run === run + 1)) continue;
      let quiet = false;
      let attempt = 0;
      do {
        attempt++;
        while (load() >= 3) {
          console.log(JSON.stringify({ waitingForLoadUnder3: load() }));
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
        const documentState = await evaluate(`(() => {
        const w = document.querySelector('iframe').contentWindow;
        const d = w.document;
        const tilt = d.querySelector('.tilt');
        w.__tiltUpdates = 0;
        w.__tiltObserver = new w.MutationObserver(list => w.__tiltUpdates += list.length);
        w.__tiltObserver.observe(tilt, {attributes:true});
        return {nodes:d.querySelectorAll('*').length, heading:tilt.style.transform};
      })()`);
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
          join(output, `${side}-${run}-${attempt}.trace.json.gz`),
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
        if (!presented.length)
          throw new Error("No presentation events; cannot report frames shown");
        const frameIds = new Set(
          presented.map((event) => JSON.stringify(event.args.begin_frame_id)),
        );
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
        const mainEvents = events.filter(
          (event) =>
            event.ph === "X" &&
            event.ts >= traceStart &&
            event.ts <= traceEnd &&
            frameThreads.some((thread) => thread.pid === event.pid && thread.tid === event.tid),
        );
        const updates = mainEvents.filter((event) => event.name === "ProxyMain::BeginMainFrame");
        const renderingLongTasks = tasks.filter((task) =>
          updates.some(
            (update) =>
              update.pid === task.pid &&
              update.tid === task.tid &&
              update.ts >= task.ts &&
              update.ts < task.ts + task.dur,
          ),
        ).length;
        const stages = ["UpdateLayoutTree", "Layout", "Paint", "Layerize", "FireAnimationFrame"];
        const perUpdateMs = Object.fromEntries(
          stages.map((name) => [
            name,
            mainEvents
              .filter((event) => event.name === name)
              .reduce((sum, event) => sum + (event.dur || 0) / 1000, 0) / updates.length,
          ]),
        );
        const styleEvents = mainEvents.filter((event) => event.name === "UpdateLayoutTree");
        const styleElements = styleEvents.reduce(
          (sum, event) => sum + (event.args.elementCount || 0),
          0,
        );
        const styleMicroseconds = styleEvents.reduce((sum, event) => sum + (event.dur || 0), 0);
        const tiltUpdates = await evaluate(`(() => {
        const w = document.querySelector('iframe').contentWindow;
        w.__tiltObserver.disconnect();
        return w.__tiltUpdates;
      })()`);
        const duration = (end - start) / 1000;
        const result = {
          side,
          run: run + 1,
          attempt,
          trace: `${side}-${run}-${attempt}.trace.json.gz`,
          settings,
          durationSeconds: duration,
          loads,
          quiet: loads.every((value) => value < 4),
          presentedFrames: frameIds.size,
          presentedFps: frameIds.size / duration,
          longTasks: tasks.length,
          renderingLongTasks,
          boardUpdates: updates.length,
          tiltUpdates,
          documentState,
          perUpdateMs,
          styledElementsPerUpdate: styleElements / updates.length,
          styleMicrosecondsPerElement: styleMicroseconds / styleElements,
          longTaskMeanMs: tasks.reduce((sum, task) => sum + task.dur / 1000, 0) / tasks.length,
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
        console.log(JSON.stringify({ ...result, layers: { ...result.layers, rows: undefined } }));
        quiet = result.quiet;
        if (!quiet) {
          appendFileSync(join(output, "rejected.jsonl"), JSON.stringify(result) + "\n");
          continue;
        }
        results.push(result);
        writeFileSync(join(output, "measurements.json"), JSON.stringify(results, null, 2));
      } while (!quiet);
    }
  }
}
socket.close();
await browser("close");
for (const server of servers) await new Promise((resolve) => server.close(resolve));
