import { data, resource, operation } from "@tinker/core";
import { searchEvent, searchInput, type Flights } from "../contracts/flights";
export const flightDraft = data({
  label: "flight draft",
  initial: { origin: "LHR", destination: "AMS", date: "2027-01-15" },
});
export const flightRows = data<Flights.Row[]>({ label: "flight rows", initial: [] });
export const flightProgress = data<Record<string, string>>({
  label: "flight progress",
  initial: {},
});
export const flightNotice = data({ label: "flight notice", initial: "" });
/** EventSource owns framing; each search retains its own queue and stop listener. */
const searchWork = resource({
  label: "search work",
  factory: (_, ctx) => {
    let close: (() => void) | undefined;
    ctx.defer(() => close?.());
    const queue: string[] = [];
    let ended = true;
    let version = 0;
    let waiting: ReturnType<typeof Promise.withResolvers<void>> | undefined;
    return {
      connect(query: Flights.Query, signal: AbortSignal) {
        close?.();
        queue.length = 0;
        version += 1;
        ended = false;
        const source = new EventSource(
          `/api/flights/search?${new URLSearchParams(query).toString()}`,
        );
        const end = () => {
          if (ended) return;
          ended = true;
          source.close();
          signal.removeEventListener("abort", end);
          waiting?.resolve();
        };
        close = end;
        source.addEventListener("flight", (event: MessageEvent<string>) => {
          if (ended) return;
          queue.push(event.data);
          waiting?.resolve();
        });
        source.addEventListener("complete", end);
        source.addEventListener("error", end);
        signal.addEventListener("abort", end, { once: true });
        if (signal.aborted) end();
        return version;
      },
      current(token: number) {
        return token === version;
      },
      close(token: number) {
        if (token === version) close?.();
      },
      async next(token: number) {
        while (token === version && !ended && queue.length === 0) {
          const received = Promise.withResolvers<void>();
          waiting = received;
          await received.promise;
          if (waiting === received) waiting = undefined;
        }
        return token === version ? queue.shift() : undefined;
      },
    };
  },
});

export const editFlightDraft = operation({
  label: "edit flight draft",
  input: searchInput,
  depends: { draft: flightDraft.controller },
  run({ draft }, ctx) {
    draft.set(ctx.input);
  },
});
export const findFlights = operation({
  label: "find flights",
  depends: {
    draft: flightDraft,
    rows: flightRows.controller,
    progress: flightProgress.controller,
    notice: flightNotice.controller,
    work: searchWork,
  },
  async run({ draft, rows, progress, notice, work }, ctx) {
    const token = work.connect(searchInput.parse(draft), ctx.signal);
    rows.set([]);
    notice.set("Searching");
    progress.set({ "supplier-a": "pending", "supplier-b": "pending", "supplier-c": "pending" });
    try {
      for (;;) {
        const data = await work.next(token);
        if (ctx.signal.aborted || !work.current(token)) return;
        if (data === undefined) break;
        const event = searchEvent.parse(JSON.parse(data));
        progress.update((all) => ({ ...all, [event.supplier]: event.status }));
        rows.update((all) => {
          const merged = new Map(all.map((row) => [row.flight_id, row]));
          for (const row of event.offers) {
            const previous = merged.get(row.flight_id);
            if (
              !previous ||
              (Number(row.total_amount) - Number(previous.total_amount) ||
                row.supplier.localeCompare(previous.supplier)) < 0
            )
              merged.set(row.flight_id, row);
          }
          return [...merged.values()].sort(
            (a, b) =>
              Number(a.total_amount) - Number(b.total_amount) ||
              a.flight_id.localeCompare(b.flight_id) ||
              a.supplier.localeCompare(b.supplier),
          );
        });
      }
      notice.set("Search complete");
    } finally {
      work.close(token);
    }
  },
});
