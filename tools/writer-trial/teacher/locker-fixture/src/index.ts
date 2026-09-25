export type { Parcel, Size } from "./model.ts";
export {
  LOCKERS,
  parcels,
  receiveParcel,
  storeParcel,
  collectParcel,
  returnToDesk,
  undoDesk,
} from "./model.ts";
export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
export { LockerApp } from "./LockerApp.tsx";
