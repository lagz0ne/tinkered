import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import {
  DEFAULT_DATE,
  bookBooking,
  bookSeries,
  cancelBooking,
  cancelSeries,
  discardEdit,
  openEdit,
  renameSeries,
  saveEdit,
  undoChange,
} from "./model.ts";
import type { Booking, Room } from "./model.ts";
import { errorKind, fail } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The booking form text as typed. */
export type BookForm = {
  readonly title: string;
  readonly room: string;
  readonly date: string;
  readonly start: string;
  readonly end: string;
  readonly weeks: string;
};

/** One booking form field. */
export type BookField = keyof BookForm;

/** The open draft's text as typed. */
export type EditForm = {
  readonly title: string;
  readonly room: string;
  readonly date: string;
  readonly start: string;
  readonly end: string;
};

/** One draft field. */
export type EditField = keyof EditForm;

/** Which rooms the list shows. Filtering never deletes. */
export type Filter = "All" | Room;

/** One list row as the screen shows it. */
export type BookingLine = {
  readonly id: string;
  readonly title: string;
  readonly room: string;
  readonly date: string;
  readonly time: string;
  readonly seriesId?: string;
};

const emptyForm: BookForm = {
  title: "",
  room: "Cedar",
  date: DEFAULT_DATE,
  start: "",
  end: "",
  weeks: "1",
};

/** The booking form text. */
export const bookForm: Data.Cell<BookForm> = data({ label: "bookForm", initial: emptyForm });

/** The open draft's text; the draft itself is `editDraft`. */
export const editForm: Data.Cell<EditForm> = data({
  label: "editForm",
  initial: { title: "", room: "Cedar", date: DEFAULT_DATE, start: "", end: "" },
});

/** The rooms the list shows. */
export const roomFilter: Data.Cell<Filter> = data({ label: "roomFilter", initial: "All" });

/** The error kind the alert shows; undefined when there is none. */
export const notice: Data.Cell<Name | undefined> = data({ label: "notice", initial: undefined });

/** The series the series-title editor renames; undefined when it is closed. */
export const seriesChoice: Data.Cell<string | undefined> = data({
  label: "seriesChoice",
  initial: undefined,
});

/** The series-title editor's text as typed. */
export const seriesTitleText: Data.Cell<string> = data({ label: "seriesTitleText", initial: "" });

const CLOCK = /^(\d{1,2}):(\d{2})$/;

/** Minutes since midnight from `HH:MM` text; anything else is BadTime with the text. */
function readClock(text: string): number {
  const parts = CLOCK.exec(text.trim());
  if (parts === null) throw fail("BadTime", { value: text });
  const hours = Number(parts[1]);
  const minutes = Number(parts[2]);
  if (hours > 23 || minutes > 59) throw fail("BadTime", { value: text });
  return hours * 60 + minutes;
}

/** A whole number of weeks from its text; anything else is BadCount with the text. */
function readWeeksText(text: string): number {
  if (!/^\d+$/.test(text.trim())) throw fail("BadCount", { weeks: text });
  return Number(text.trim());
}

/** Minutes since midnight as `HH:MM`. */
export function clockText(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, "0");
  return `${hours}:${String(minutes % 60).padStart(2, "0")}`;
}

/** The list rows one filter shows, in saved order. */
export function bookingLines(saved: readonly Booking[], filter: Filter): readonly BookingLine[] {
  return saved
    .filter((booking) => filter === "All" || booking.room === filter)
    .map((booking) => ({
      id: booking.id,
      title: booking.title,
      room: booking.room,
      date: booking.date,
      time: `${clockText(booking.start)}–${clockText(booking.end)}`,
      ...(booking.seriesId === undefined ? {} : { seriesId: booking.seriesId }),
    }));
}

const kindOf = (error: unknown): Name => {
  const kind = errorKind(error);
  if (kind === undefined) throw error;
  return kind;
};

/** Type into one booking form field. */
export const typeBookForm: Operation.Handle<void, { field: BookField; value: string }> = operation({
  label: "typeBookForm",
  depends: { form: bookForm.controller },
  run: ({ form }, { input }) => {
    form.update((text) => ({ ...text, [input.field]: input.value }));
  },
});

/** Type into one draft field. */
export const typeEditForm: Operation.Handle<void, { field: EditField; value: string }> = operation({
  label: "typeEditForm",
  depends: { form: editForm.controller },
  run: ({ form }, { input }) => {
    form.update((text) => ({ ...text, [input.field]: input.value }));
  },
});

/** Type into the series-title editor. */
export const typeSeriesTitle: Operation.Handle<void, { value: string }> = operation({
  label: "typeSeriesTitle",
  depends: { text: seriesTitleText.controller },
  run: ({ text }, { input }) => {
    text.set(input.value);
  },
});

/** Show all rooms or one room. */
export const chooseFilter: Operation.Handle<void, Filter> = operation({
  label: "chooseFilter",
  depends: { filter: roomFilter.controller },
  run: ({ filter }, { input }) => {
    filter.set(input);
  },
});

/** Book the form. Success clears the title; failure keeps every field. */
export const submitBook: Operation.Handle<void, void> = operation({
  label: "submitBook",
  depends: { form: bookForm.controller, shown: notice.controller, book: bookBooking.controller },
  run: ({ form, shown, book }) => {
    const text = form.get();
    try {
      book.run({
        input: {
          title: text.title,
          room: text.room,
          date: text.date,
          start: readClock(text.start),
          end: readClock(text.end),
        },
      });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    form.update((now) => ({ ...now, title: "" }));
    shown.set(undefined);
  },
});

/** Book the form as a weekly series. Success clears the title; failure keeps every field. */
export const submitSeries: Operation.Handle<void, void> = operation({
  label: "submitSeries",
  depends: { form: bookForm.controller, shown: notice.controller, book: bookSeries.controller },
  run: ({ form, shown, book }) => {
    const text = form.get();
    try {
      book.run({
        input: {
          title: text.title,
          room: text.room,
          date: text.date,
          start: readClock(text.start),
          end: readClock(text.end),
          weeks: readWeeksText(text.weeks),
        },
      });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    form.update((now) => ({ ...now, title: "" }));
    shown.set(undefined);
  },
});

/** Cancel one row's booking. */
export const submitCancel: Operation.Handle<void, { id: string }> = operation({
  label: "submitCancel",
  depends: { shown: notice.controller, cancel: cancelBooking.controller },
  run: ({ shown, cancel }, { input }) => {
    try {
      cancel.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Cancel one row's whole series. */
export const submitCancelSeries: Operation.Handle<void, { seriesId: string }> = operation({
  label: "submitCancelSeries",
  depends: { shown: notice.controller, cancel: cancelSeries.controller },
  run: ({ shown, cancel }, { input }) => {
    try {
      cancel.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Undo the last passing change. Form text, the draft, and the filter stay. */
export const submitUndo: Operation.Handle<void, void> = operation({
  label: "submitUndo",
  depends: { shown: notice.controller, undo: undoChange.controller },
  run: ({ shown, undo }) => {
    try {
      undo.run({});
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Open one row's draft; the fields now show that booking and drop earlier unsaved text. */
export const submitOpenEdit: Operation.Handle<void, { id: string }> = operation({
  label: "submitOpenEdit",
  depends: { form: editForm.controller, shown: notice.controller, open: openEdit.controller },
  run: ({ form, shown, open }, { input }) => {
    try {
      const booking = open.run({ input });
      form.set({
        title: booking.title,
        room: booking.room,
        date: booking.date,
        start: clockText(booking.start),
        end: clockText(booking.end),
      });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Save the open draft's text. Failure keeps the draft open with its text. */
export const submitSaveEdit: Operation.Handle<void, { id: string }> = operation({
  label: "submitSaveEdit",
  depends: { form: editForm.controller, shown: notice.controller, save: saveEdit.controller },
  run: ({ form, shown, save }, { input }) => {
    const text = form.get();
    try {
      save.run({
        input: {
          id: input.id,
          title: text.title,
          room: text.room,
          date: text.date,
          start: readClock(text.start),
          end: readClock(text.end),
        },
      });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Drop the open draft. */
export const submitDiscardEdit: Operation.Handle<void, { id: string }> = operation({
  label: "submitDiscardEdit",
  depends: { shown: notice.controller, discard: discardEdit.controller },
  run: ({ shown, discard }, { input }) => {
    try {
      discard.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Open the series-title editor on one row's series; earlier unsaved text is dropped. */
export const openSeriesTitle: Operation.Handle<void, { seriesId: string; title: string }> =
  operation({
    label: "openSeriesTitle",
    depends: { choice: seriesChoice.controller, text: seriesTitleText.controller },
    run: ({ choice, text }, { input }) => {
      choice.set(input.seriesId);
      text.set(input.title);
    },
  });

/** Rename the chosen series. Success closes the editor; failure keeps it and its text. */
export const submitSeriesTitle: Operation.Handle<void, { seriesId: string }> = operation({
  label: "submitSeriesTitle",
  depends: {
    choice: seriesChoice.controller,
    text: seriesTitleText.controller,
    shown: notice.controller,
    rename: renameSeries.controller,
  },
  run: ({ choice, text, shown, rename }, { input }) => {
    try {
      rename.run({ input: { seriesId: input.seriesId, title: text.get() } });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    choice.set(undefined);
    shown.set(undefined);
  },
});

/** Close the series-title editor; no booking or undo step changes. */
export const discardSeriesTitle: Operation.Handle<void, void> = operation({
  label: "discardSeriesTitle",
  depends: { choice: seriesChoice.controller, shown: notice.controller },
  run: ({ choice, shown }) => {
    choice.set(undefined);
    shown.set(undefined);
  },
});
