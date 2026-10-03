import { flightRows } from "./flights.ts";
import { bookingRows } from "./state.ts";
import { resource } from "@tinker/core";
import { profile, todos, counter, nameDraft, profileResult } from "./state.ts";
import type { Sync } from "../contracts/sync.ts";
/** Saved records have one publisher; drafts belong to the local editor. */
export const records = resource({
  label: "records",
  depends: {
    profile: profile.controller,
    todos: todos.controller,
    counter: counter.controller,
    draft: nameDraft.controller,
    bookings: bookingRows.controller,
    flights: flightRows.controller,
    result: profileResult.controller,
  },
  factory: ({ profile, todos, counter, draft, result, bookings, flights }) => ({
    resetPrivate() {
      profile.set(null);
      todos.set([]);
      bookings.set([]);
      draft.set(undefined);
      result.set(null);
    },
    bootstrapPublic(value: Sync.Snapshot["public"], after: number) {
      if (value.revision >= after) counter.set(value.value);
    },
    bootstrapPrivate(value: NonNullable<Sync.Snapshot["private"]>, after: number) {
      if (value.revision < after) return;
      profile.set(value.profile);
      todos.set(value.todos);
      bookings.set(value.bookings);
    },
    change(change: Sync.Change) {
      switch (change.kind) {
        case "flightSeats":
          flights.update((rows) =>
            rows.map((row) =>
              row.supplier === change.supplier &&
              row.flight_id === change.flightId &&
              row.cabin_class === change.cabin
                ? { ...row, available_seats: change.seats }
                : row,
            ),
          );
          break;
        case "counter":
          counter.set(change.value);
          break;
        case "profile":
          profile.set(change.profile);
          break;
        case "bookings":
          bookings.set(change.rows);
          break;
        case "todos":
          todos.set(change.rows);
          break;
      }
    },
    snapshot(publicRevision: number, privateRevision: number): Sync.Snapshot {
      const saved = profile.get();
      return {
        public: { stream: "public", revision: Math.max(0, publicRevision), value: counter.get() },
        private:
          saved === null
            ? null
            : {
                stream: saved.id,
                revision: Math.max(0, privateRevision),
                profile: saved,
                todos: todos.get(),
                bookings: bookings.get(),
              },
      };
    },
  }),
});
