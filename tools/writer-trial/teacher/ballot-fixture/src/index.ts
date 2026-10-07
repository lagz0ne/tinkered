export type { Poll, Vote } from "./model";
export {
  polls,
  votes,
  createPoll,
  setLimit,
  closePoll,
  castVote,
  withdrawVote,
  undoPoll,
} from "./model";
export { isError } from "./errors";
export type { Errors } from "./errors";
export { PollApp } from "./PollApp";
