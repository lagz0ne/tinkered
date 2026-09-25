export type { Poll, Vote } from "./model.ts";
export {
  polls,
  votes,
  createPoll,
  setLimit,
  closePoll,
  castVote,
  withdrawVote,
  undoPoll,
} from "./model.ts";
export { isError } from "./errors.ts";
export type { Errors } from "./errors.ts";
export { PollApp } from "./PollApp.tsx";
