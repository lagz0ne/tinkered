import { data, resource, operation } from "@tinker/core";
import { searchEvent, searchInput, type Flights } from "../contracts/flights.ts";
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
/** The resource retains only native cancellation work; shown state lives in cells. */
const searchWork = resource({
  label: "search work",
  factory: (_, ctx) => {
    const work: { stop?: AbortController } = {};
    ctx.defer(() => work.stop?.abort());
    return work;
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
    work.stop?.abort();
    const stop = new AbortController();
    work.stop = stop;
    const signal = AbortSignal.any([ctx.signal, stop.signal]);
    rows.set([]);
    notice.set("Searching");
    progress.set({ "supplier-a": "pending", "supplier-b": "pending", "supplier-c": "pending" });
    try {
      const response = await fetch(
        `/api/flights/search?${new URLSearchParams(searchInput.parse(draft)).toString()}`,
        { signal },
      );
      const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const part = await reader.read();
        if (signal.aborted) return;
        if (part.done) break;
        buffer += part.value;
        let end = buffer.indexOf("\n");
        while (end >= 0) {
          const event = searchEvent.parse(JSON.parse(buffer.slice(0, end)));
          buffer = buffer.slice(end + 1);
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
          end = buffer.indexOf("\n");
        }
      }
      notice.set("Search complete");
    } catch (error) {
      if (!signal.aborted) throw error;
    }
  },
});
