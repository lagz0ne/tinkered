export type { Ticket } from "./model.ts";
export {
  MENU,
  tickets,
  stove,
  addTicket,
  startCooking,
  serveTicket,
  cancelTicket,
  setStove,
  undoKitchen,
} from "./model.ts";
export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
export { KitchenApp } from "./KitchenApp.tsx";
