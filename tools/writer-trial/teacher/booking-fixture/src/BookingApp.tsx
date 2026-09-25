import type { ChangeEvent, FormEvent, ReactElement } from "react";
import { createScope } from "@tinker/core";
import { ScopeProvider, useData, useRun } from "@tinker/react";
import { bookings, editDraft, rooms } from "./model.ts";
import {
  bookForm,
  bookingLines,
  chooseFilter,
  discardSeriesTitle,
  editForm,
  notice,
  openSeriesTitle,
  roomFilter,
  seriesChoice,
  seriesTitleText,
  submitBook,
  submitCancel,
  submitCancelSeries,
  submitDiscardEdit,
  submitOpenEdit,
  submitSaveEdit,
  submitSeries,
  submitSeriesTitle,
  submitUndo,
  typeBookForm,
  typeEditForm,
  typeSeriesTitle,
} from "./screen.ts";
import type { BookField, BookingLine, EditField, Filter } from "./screen.ts";
import { Field, NamedTable, Notice, Page } from "./layout.tsx";

const filters: readonly Filter[] = ["All", ...rooms];

type FieldEvent = ChangeEvent<HTMLInputElement | HTMLSelectElement>;

/** The room choices for a Room or Edit room select. */
function RoomOptions(): ReactElement {
  return (
    <>
      {rooms.map((room) => (
        <option key={room} value={room}>
          {room}
        </option>
      ))}
    </>
  );
}

/** The booking form: Title, Room, Date, Start time, End time, Weeks, Book, and Book series. */
function BookingForm(): ReactElement {
  const text = useData(bookForm);
  const type = useRun(typeBookForm);
  const book = useRun(submitBook);
  const series = useRun(submitSeries);
  const typed = (field: BookField) => (event: FieldEvent) =>
    type.run({ input: { field, value: event.target.value } });
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        book.run();
      }}
    >
      <Field name="Title" control={<input value={text.title} onChange={typed("title")} />} />
      <Field
        name="Room"
        control={
          <select value={text.room} onChange={typed("room")}>
            <RoomOptions />
          </select>
        }
      />
      <Field name="Date" control={<input value={text.date} onChange={typed("date")} />} />
      <Field name="Start time" control={<input value={text.start} onChange={typed("start")} />} />
      <Field name="End time" control={<input value={text.end} onChange={typed("end")} />} />
      <Field name="Weeks" control={<input value={text.weeks} onChange={typed("weeks")} />} />
      <button type="submit">Book</button>
      <button type="button" onClick={() => series.run()}>
        Book series
      </button>
    </form>
  );
}

/** The open draft's fields with Save and Discard; nothing when no draft is open. */
function EditPanel(): ReactElement | null {
  const draft = useData(editDraft);
  const text = useData(editForm);
  const type = useRun(typeEditForm);
  const save = useRun(submitSaveEdit);
  const discard = useRun(submitDiscardEdit);
  if (draft === undefined) return null;
  const typed = (field: EditField) => (event: FieldEvent) =>
    type.run({ input: { field, value: event.target.value } });
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        save.run({ input: { id: draft.id } });
      }}
    >
      <Field name="Edit title" control={<input value={text.title} onChange={typed("title")} />} />
      <Field
        name="Edit room"
        control={
          <select value={text.room} onChange={typed("room")}>
            <RoomOptions />
          </select>
        }
      />
      <Field name="Edit date" control={<input value={text.date} onChange={typed("date")} />} />
      <Field
        name="Edit start time"
        control={<input value={text.start} onChange={typed("start")} />}
      />
      <Field name="Edit end time" control={<input value={text.end} onChange={typed("end")} />} />
      <button type="submit">Save</button>
      <button type="button" onClick={() => discard.run({ input: { id: draft.id } })}>
        Discard
      </button>
    </form>
  );
}

/** The series-title editor; nothing when it is closed. */
function SeriesTitlePanel(): ReactElement | null {
  const seriesId = useData(seriesChoice);
  const title = useData(seriesTitleText);
  const type = useRun(typeSeriesTitle);
  const save = useRun(submitSeriesTitle);
  const discard = useRun(discardSeriesTitle);
  if (seriesId === undefined) return null;
  return (
    <form
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        save.run({ input: { seriesId } });
      }}
    >
      <Field
        name="Series title"
        control={
          <input
            value={title}
            onChange={(event) => type.run({ input: { value: event.target.value } })}
          />
        }
      />
      <button type="submit">Save series title</button>
      <button type="button" onClick={() => discard.run()}>
        Discard series title
      </button>
    </form>
  );
}

/** The series buttons a series row adds. */
function SeriesButtons(props: { readonly line: BookingLine; readonly seriesId: string }) {
  const { line, seriesId } = props;
  const cancelAll = useRun(submitCancelSeries);
  const rename = useRun(openSeriesTitle);
  return (
    <>
      <button type="button" onClick={() => cancelAll.run({ input: { seriesId } })}>
        Cancel series
      </button>
      <button
        type="button"
        aria-label={`Rename series ${line.title}`}
        onClick={() => rename.run({ input: { seriesId, title: line.title } })}
      >
        Rename series
      </button>
    </>
  );
}

/** The buttons one row has: Edit and Cancel, plus the series buttons on a series row. */
function RowButtons(props: { readonly line: BookingLine }): ReactElement {
  const { line } = props;
  const edit = useRun(submitOpenEdit);
  const cancel = useRun(submitCancel);
  return (
    <>
      <button
        type="button"
        aria-label={`Edit ${line.title}`}
        onClick={() => edit.run({ input: { id: line.id } })}
      >
        Edit
      </button>
      <button
        type="button"
        aria-label={`Cancel ${line.title}`}
        onClick={() => cancel.run({ input: { id: line.id } })}
      >
        Cancel
      </button>
      {line.seriesId === undefined ? null : <SeriesButtons line={line} seriesId={line.seriesId} />}
    </>
  );
}

/** The filter buttons and the Bookings table. */
function BookingList(): ReactElement {
  const saved = useData(bookings);
  const filter = useData(roomFilter);
  const choose = useRun(chooseFilter);
  return (
    <>
      <div>
        {filters.map((each) => (
          <button
            key={each}
            type="button"
            aria-pressed={each === filter}
            onClick={() => choose.run({ input: each })}
          >
            {each}
          </button>
        ))}
      </div>
      <NamedTable
        name="Bookings"
        headers={["Title", "Room", "Date", "Time"]}
        rows={bookingLines(saved, filter).map((line) => ({
          key: line.id,
          cells: [line.title, line.room, line.date, line.time],
          actions: <RowButtons line={line} />,
        }))}
      />
    </>
  );
}

/** The shared alert and the Undo button. */
function NoticeArea(): ReactElement {
  const shown = useData(notice);
  const undo = useRun(submitUndo);
  return (
    <>
      <Notice text={shown} />
      <button type="button" onClick={() => undo.run()}>
        Undo
      </button>
    </>
  );
}

/** One BookingApp owns a fresh scope. Two apps share nothing. */
export function BookingApp(): ReactElement {
  return (
    <ScopeProvider create={() => createScope()}>
      <Page>
        <BookingForm />
        <NoticeArea />
        <EditPanel />
        <SeriesTitlePanel />
        <BookingList />
      </Page>
    </ScopeProvider>
  );
}
