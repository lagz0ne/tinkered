# 0084 A request commits before it answers; a raised error rolls it back

Date: 2026-09-29. Status: accepted. Refines: 0041 (the transaction is a session resource whose
commit is the session's success), 0039 (a request is a session), 0067 (managed errors), 0077
(`@tinker/hono` answers managed errors). Found by the stack/t12 review.

## Context

Two gaps in `@tinker/hono`'s request lifecycle:

- It closes the request session after the answer is built and ignores the close result. A commit
  that fails at close still answers HTTP 200 with nothing saved.
- An operation that saves a row and then raises a managed error mapped to 409 keeps the row.
  The route answered the error, so the session closes as a success and commits.

**The precedent is Django's `ATOMIC_REQUESTS`.** The view runs in one transaction. An exception
out of the view rolls it back, even when middleware turns it into a 4xx answer. The commit runs
before the answer leaves, and a failed commit is a 500.

## Decision

1. **A request's session closes before its answer leaves.** The commit happens then. A close that
   does not end clean (a failed commit, or any teardown error) answers 500 instead of the built
   answer and logs one line through the scope's sink.
2. **Any error the route's operation raised closes the request session as failed,** mapped or
   not, so its transaction rolls back. The mapped answer (a 4xx) still goes out.
3. **A streamed answer** sends its headers before the body ends, so its session closes when the
   stream ends. A failed commit then errors the stream and logs one line; its status cannot change.
4. The user chose rollback on 2026-09-29.

## Consequences

- A mapped 4xx now means "nothing changed".
- Publish after commit and the live signal (stack/t12) see the request's real outcome.
- A job added in a request that answered 4xx never exists (ADR 0075).

## Options considered

- **Keep writes on a mapped 4xx; only a 500 rolls back.** Rejected by the user: an operation would
  have to undo its own writes by hand.
