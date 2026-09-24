import { data, operation } from "@tinker/core";
import type { Data, Operation } from "@tinker/core";
import { collectParcel, receiveParcel, returnToDesk, storeParcel, undoDesk } from "./model.ts";
import type { Parcel, ParcelState, Size } from "./model.ts";
import { errorKind } from "./errors.ts";
import type { Name } from "./errors.ts";

/** The receive form: recipient and size text as typed. */
export type ReceiveDraft = { recipient: string; size: string };

/** The store form: the chosen parcel id and the locker text as typed. */
export type StoreDraft = { parcelId: string; locker: string };

/** Which parcel rows the Parcels table shows. Filtering never deletes. */
export type ParcelFilter = "All" | "Held" | "Stored" | "Collected";

/** How a parcel state reads on screen. */
export type StateText = "Held" | "Stored" | "Collected";

/** One Parcels table row. */
export type ParcelRow = {
  id: string;
  recipient: string;
  size: Size;
  locker: number | null;
  state: StateText;
};

/** One Parcel select option: the parcel id and its label. */
export type ParcelChoice = { value: string; label: string };

const emptyReceive: ReceiveDraft = { recipient: "", size: "" };
const emptyStore: StoreDraft = { parcelId: "", locker: "" };

export const receiveDraft: Data.Cell<ReceiveDraft> = data({
  label: "receiveDraft",
  initial: emptyReceive,
});

export const storeDraft: Data.Cell<StoreDraft> = data({ label: "storeDraft", initial: emptyStore });

export const parcelFilter: Data.Cell<ParcelFilter> = data({
  label: "parcelFilter",
  initial: "All",
});

export const notice: Data.Cell<Name | undefined> = data({ label: "notice", initial: undefined });

const STATE_TEXT: Readonly<Record<ParcelState, StateText>> = {
  held: "Held",
  stored: "Stored",
  collected: "Collected",
};

const shownBy = (filter: ParcelFilter, state: StateText): boolean =>
  filter === "All" || filter === state;

/** Parcels table rows for one filter, in saved parcel order. */
export const parcelRows = (saved: readonly Parcel[], filter: ParcelFilter): readonly ParcelRow[] =>
  saved
    .map((parcel) => ({
      id: parcel.id,
      recipient: parcel.recipient,
      size: parcel.size,
      locker: parcel.locker,
      state: STATE_TEXT[parcel.state],
    }))
    .filter((row) => shownBy(filter, row.state));

/** Parcel select options: every held parcel, plus the chosen id once it is no longer held. */
export const parcelChoices = (
  saved: readonly Parcel[],
  chosen: string,
): readonly ParcelChoice[] => {
  const held = saved
    .filter((parcel) => parcel.state === "held")
    .map((parcel) => ({ value: parcel.id, label: `${parcel.recipient} (${parcel.size})` }));
  if (chosen === "" || held.some((choice) => choice.value === chosen)) return held;
  return [...held, { value: chosen, label: "Unavailable parcel" }];
};

const kindOf = (error: unknown): Name => {
  const kind = errorKind(error);
  if (kind === undefined) throw error;
  return kind;
};

/** Type into the Recipient input. Clears any earlier notice. */
export const typeRecipient: Operation.Handle<void, { value: string }> = operation({
  label: "typeRecipient",
  depends: { draft: receiveDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, recipient: input.value }));
    shown.set(undefined);
  },
});

/** Type into the Size input. Clears any earlier notice. */
export const typeSize: Operation.Handle<void, { value: string }> = operation({
  label: "typeSize",
  depends: { draft: receiveDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, size: input.value }));
    shown.set(undefined);
  },
});

/** Choose a parcel in the store form. Clears any earlier notice. */
export const chooseParcel: Operation.Handle<void, { parcelId: string }> = operation({
  label: "chooseParcel",
  depends: { draft: storeDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, parcelId: input.parcelId }));
    shown.set(undefined);
  },
});

/** Type into the Locker input. Clears any earlier notice. */
export const typeLocker: Operation.Handle<void, { value: string }> = operation({
  label: "typeLocker",
  depends: { draft: storeDraft.controller, shown: notice.controller },
  run: ({ draft, shown }, { input }) => {
    draft.update((text) => ({ ...text, locker: input.value }));
    shown.set(undefined);
  },
});

/** Show All, Held, Stored, or Collected rows. Clears any earlier notice. */
export const chooseFilter: Operation.Handle<void, ParcelFilter> = operation({
  label: "chooseFilter",
  depends: { filter: parcelFilter.controller, shown: notice.controller },
  run: ({ filter, shown }, { input }) => {
    filter.set(input);
    shown.set(undefined);
  },
});

/** Receive the typed parcel. Success clears both inputs; failure keeps them. */
export const submitReceive: Operation.Handle<void, void> = operation({
  label: "submitReceive",
  depends: {
    draft: receiveDraft.controller,
    shown: notice.controller,
    receive: receiveParcel.controller,
  },
  run: ({ draft, shown, receive }) => {
    try {
      receive.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.set(emptyReceive);
    shown.set(undefined);
  },
});

/** Store the chosen parcel. Success empties Parcel and Locker; failure keeps both. */
export const submitStore: Operation.Handle<void, void> = operation({
  label: "submitStore",
  depends: {
    draft: storeDraft.controller,
    shown: notice.controller,
    store: storeParcel.controller,
  },
  run: ({ draft, shown, store }) => {
    try {
      store.run({ input: draft.get() });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    draft.set(emptyStore);
    shown.set(undefined);
  },
});

/** Collect one parcel from its row button. */
export const submitCollect: Operation.Handle<void, { parcelId: string }> = operation({
  label: "submitCollect",
  depends: { shown: notice.controller, collect: collectParcel.controller },
  run: ({ shown, collect }, { input }) => {
    try {
      collect.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Return one parcel to the desk from its row button. */
export const submitReturn: Operation.Handle<void, { parcelId: string }> = operation({
  label: "submitReturn",
  depends: { shown: notice.controller, back: returnToDesk.controller },
  run: ({ shown, back }, { input }) => {
    try {
      back.run({ input });
    } catch (error) {
      shown.set(kindOf(error));
      return;
    }
    shown.set(undefined);
  },
});

/** Undo the last passing change. Form text, the chosen parcel, and the filter stay. */
export const submitUndo: Operation.Handle<void, void> = operation({
  label: "submitUndo",
  depends: { shown: notice.controller, undo: undoDesk.controller },
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
