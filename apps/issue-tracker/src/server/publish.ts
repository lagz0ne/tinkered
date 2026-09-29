import { publishAfterCommit } from "@tinker/stack";
import { publishIssues } from "./operations.ts";

export function publish() {
  return publishAfterCommit(publishIssues);
}
