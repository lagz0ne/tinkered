export type { Parcel, Size } from "./model";
export {
  LOCKERS,
  parcels,
  receiveParcel,
  storeParcel,
  collectParcel,
  returnToDesk,
  undoDesk,
} from "./model";
export { isError } from "./errors";
export type { Errors } from "./errors";
export { LockerApp } from "./LockerApp";
