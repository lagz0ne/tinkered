import { createHash } from "node:crypto";

export const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** OpenFlights CSV quotes commas and escapes a quote by doubling it. */
function readRows(bytes) {
  return bytes
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const cells = [];
      let cell = "";
      let quoted = false;
      for (let n = 0; n < line.length; n++) {
        const char = line[n];
        if (char === '"' && quoted && line[n + 1] === '"') {
          cell += '"';
          n++;
        } else if (char === '"') quoted = !quoted;
        else if (char === "," && !quoted) {
          cells.push(cell);
          cell = "";
        } else cell += char;
      }
      cells.push(cell);
      return cells;
    });
}

export function selectSource(files) {
  const airports = new Map(
    readRows(files["airports.dat"])
      .map((row) => {
        const [id, name, city, country, code, , latitude, longitude] = row;
        return [
          id,
          {
            id: Number(id),
            name,
            city,
            country,
            code,
            latitude: Number(latitude),
            longitude: Number(longitude),
          },
        ];
      })
      .filter(([, airport]) => /^[A-Z]{3}$/.test(airport.code)),
  );
  const airlines = new Map(
    readRows(files["airlines.dat"]).map((row) => {
      const [id, name, , code] = row;
      return [id, { id: Number(id), name, code }];
    }),
  );
  const routes = readRows(files["routes.dat"])
    .map((row) => {
      const [, airline, , origin, , destination, codeshare, stops] = row;
      return { airline, origin, destination, codeshare, stops };
    })
    .filter(
      (route) =>
        airlines.has(route.airline) &&
        airports.has(route.origin) &&
        airports.has(route.destination) &&
        route.codeshare === "" &&
        route.stops === "0",
    );
  const counts = new Map();
  for (const route of routes) {
    for (const id of [route.origin, route.destination]) counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  const ids = [...counts.keys()]
    .sort((a, b) => counts.get(b) - counts.get(a) || Number(a) - Number(b))
    .slice(0, 60);
  const selected = new Set(ids);
  const kept = new Map();
  for (const route of routes) {
    if (selected.has(route.origin) && selected.has(route.destination)) {
      const record = {
        airlineId: Number(route.airline),
        origin: airports.get(route.origin).code,
        destination: airports.get(route.destination).code,
      };
      kept.set(`${record.airlineId}:${record.origin}:${record.destination}`, record);
    }
  }
  const sortedRoutes = [...kept.values()].sort(
    (a, b) =>
      a.airlineId - b.airlineId ||
      (a.origin < b.origin ? -1 : a.origin > b.origin ? 1 : 0) ||
      (a.destination < b.destination ? -1 : a.destination > b.destination ? 1 : 0),
  );
  const airlineIds = new Set(sortedRoutes.map((route) => route.airlineId));
  return {
    airports: ids.map((id) => airports.get(id)).sort((a, b) => a.id - b.id),
    airlines: [...airlines.values()]
      .filter((airline) => airlineIds.has(airline.id))
      .sort((a, b) => a.id - b.id),
    routes: sortedRoutes,
  };
}

export async function fetchSources(commit) {
  const files = {};
  for (const name of ["airports.dat", "airlines.dat", "routes.dat"]) {
    const url = `https://raw.githubusercontent.com/jpatokal/openflights/${commit}/data/${name}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status} ${url}`);
    files[name] = Buffer.from(await response.arrayBuffer());
  }
  return files;
}

export const encodeSource = (source) => `${JSON.stringify(source)}\n`;
