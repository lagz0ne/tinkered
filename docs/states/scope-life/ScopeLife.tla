---------------------------- MODULE ScopeLife ----------------------------
(* A root scope made with a stop signal and two capsules (packages/core/src/index.ts:
   runStartChain, watchRootClose, listenForStop), with the ADR 0165 fix (card
   core/stop-signal-then-later-event): a stop signal that came first is the start's cause.
   Capsule 1 is outer, capsule 2 is inner. Each start hook does some async work, calls
   next(), and after next() resolves it opens a port at once (as `serve` runs Bun.serve).
   Its close hook closes that port. Close hooks run in reverse order: capsule 2, then 1.
   JS detail: from "capsule 2 calls next()" to "ready resolves" is one microtask chain, so no
   outside event (a close, the signal, the timer) can land inside it. That chain is one step. *)
EXTENDS Naturals

VARIABLES
  h1, h2,          \* start hook state: idle, before (runs, before next), waiting (awaits next),
                   \* done (did its after-work), out (next rejected, no after-work), threw
  port1, port2,    \* the port a hook opened is still open
  preAborted,      \* the signal was aborted before createScope
  sig,             \* the signal has aborted
  halt,            \* code: `halt`, a stop asked by the signal during start
  claimed,         \* code: `lifetime.stopStart` is gone and `stop` aborted: next() now rejects
  chain,           \* code: at(0): notStarted, running, settled
  closeState,      \* none, hooks2, hooks1 (close hooks to run), layer, done
  closeMode,       \* none, forced, graceful
  realError,       \* a real error is on the layer (layer.failed, or a stuck start error)
  ready,           \* pending, resolved, rejected
  readyReason,     \* none, closing (code 20), signal, error, timeout
  pendingReject,   \* the reason `end()` rejects ready with once the close ends
  closed,          \* pending, success, cancelled, failed
  ranCloseHooks,   \* which close hooks ran
  \* ghost variables, for the rules only
  firstStop,       \* the first of: signal, close, timeout, error, while ready is pending
  stopSeen,        \* a stop (close, signal, timeout) came while ready was pending
  badAfterWork,    \* a hook did its after-work after a stop
  badHookStart     \* a hook started after a stop

vars == <<h1, h2, port1, port2, preAborted, sig, halt, claimed, chain, closeState, closeMode,
          realError, ready, readyReason, pendingReject, closed, ranCloseHooks,
          firstStop, stopSeen, badAfterWork, badHookStart>>

Stopped == halt \/ claimed               \* code: stopped() throws CLOSING_REASON
Halted == halt /\ ~claimed               \* code: halted()

Init ==
  /\ preAborted \in BOOLEAN
  /\ sig = preAborted
  /\ halt = preAborted
  /\ h1 = "idle" /\ h2 = "idle"
  /\ port1 = FALSE /\ port2 = FALSE
  /\ claimed = FALSE
  /\ chain = "notStarted"
  /\ closeState = "none" /\ closeMode = "none"
  /\ realError = FALSE
  /\ ready = "pending" /\ readyReason = "none" /\ pendingReject = "none"
  /\ closed = "pending"
  /\ ranCloseHooks = {}
  /\ firstStop = IF preAborted THEN "pre" ELSE "none"
  /\ stopSeen = preAborted
  /\ badAfterWork = FALSE /\ badHookStart = FALSE

(* end(reason) when its claim wins: claim, then the forced close (scope.close()), and ready
   rejects with the reason once that close ends. A non-closing reason sets layer.failed.
   A stop signal that came first is the cause instead (halt): a cancel, no layer.failed. *)
EndWins(reason) ==
  /\ claimed' = TRUE
  /\ closeState' = "hooks2"
  /\ closeMode' = "forced"
  /\ pendingReject' = IF halt THEN "signal" ELSE reason
  /\ realError' = (realError \/ (~halt /\ reason \in {"error", "timeout"}))

(* at(0) settled with CLOSING_REASON (a stop): end(signal) if halted, else nothing. *)
ChainStopped ==
  IF Halted THEN EndWins("signal")
  ELSE UNCHANGED <<claimed, closeState, closeMode, pendingReject, realError>>

\* createScope runs the start chain at once.
ScopeStarts ==
  /\ chain = "notStarted"
  /\ IF Stopped
       THEN /\ chain' = "settled"           \* at(0) throws before hook 1: no hook runs
            /\ ChainStopped
            /\ UNCHANGED <<h1, badHookStart>>
       ELSE /\ chain' = "running"
            /\ h1' = "before"
            /\ badHookStart' = (badHookStart \/ stopSeen)
            /\ UNCHANGED <<claimed, closeState, closeMode, pendingReject, realError>>
  /\ UNCHANGED <<h2, port1, port2, preAborted, sig, halt, ready, readyReason, closed,
                 ranCloseHooks, firstStop, stopSeen, badAfterWork>>

\* Hook 1 calls next(): at(1) checks for a stop, then starts hook 2.
Hook1CallsNext ==
  /\ h1 = "before"
  /\ IF Stopped
       THEN /\ h1' = "out" /\ chain' = "settled"
            /\ ChainStopped
            /\ UNCHANGED <<h2, badHookStart>>
       ELSE /\ h1' = "waiting" /\ h2' = "before"
            /\ badHookStart' = (badHookStart \/ stopSeen)
            /\ UNCHANGED <<chain, claimed, closeState, closeMode, pendingReject, realError>>
  /\ UNCHANGED <<port1, port2, preAborted, sig, halt, ready, readyReason, closed,
                 ranCloseHooks, firstStop, stopSeen, badAfterWork>>

(* Hook 2 calls next(): at(2) is empty; `.then(stopped)` rejects after a stop. Else the
   microtask chain runs to its end: hook 2 opens its port, hook 1's next() passes the same
   check, hook 1 opens its port, at(0) resolves, the start is claimed and ready resolves. *)
Hook2CallsNext ==
  /\ h2 = "before"
  /\ chain' = "settled"
  /\ IF Stopped
       THEN /\ h2' = "out" /\ h1' = "out"
            /\ ChainStopped
            /\ UNCHANGED <<port1, port2, ready, badAfterWork>>
       ELSE /\ h2' = "done" /\ h1' = "done"
            /\ port1' = TRUE /\ port2' = TRUE
            /\ badAfterWork' = (badAfterWork \/ stopSeen)
            /\ claimed' = TRUE
            /\ ready' = "resolved"
            /\ UNCHANGED <<closeState, closeMode, pendingReject, realError>>
  /\ UNCHANGED <<preAborted, sig, halt, readyReason, closed, ranCloseHooks, firstStop,
                 stopSeen, badHookStart>>

(* A start hook throws a real error before its next(). Hook 1 (waiting) rethrows it, so
   at(0) rejects with it: end(error). Its claim wins only if nothing claimed the start yet;
   else the error sticks on the layer (stick, addError), unless a stop signal came first. *)
HookThrows(c) ==
  /\ IF c = 1 THEN h1 = "before" ELSE h2 = "before"
  /\ h1' = IF c = 1 THEN "threw" ELSE "out"
  /\ h2' = IF c = 2 THEN "threw" ELSE h2
  /\ chain' = "settled"
  /\ IF claimed
       THEN /\ realError' = (realError \/ ~halt)
            /\ UNCHANGED <<claimed, closeState, closeMode, pendingReject>>
       ELSE EndWins("error")
  /\ firstStop' = IF firstStop = "none" /\ ready = "pending" THEN "error" ELSE firstStop
  /\ UNCHANGED <<port1, port2, preAborted, sig, halt, ready, readyReason, closed,
                 ranCloseHooks, stopSeen, badAfterWork, badHookStart>>

\* The start timer fires (it is cleared once the start is claimed): end(StartTimeout).
StartTimesOut ==
  /\ chain = "running" /\ ~claimed
  /\ EndWins("timeout")
  /\ firstStop' = IF firstStop = "none" THEN "timeout" ELSE firstStop
  /\ stopSeen' = TRUE
  /\ UNCHANGED <<h1, h2, port1, port2, preAborted, sig, halt, chain, ready, readyReason,
                 closed, ranCloseHooks, badAfterWork, badHookStart>>

(* The stop signal aborts. Its listener is gone once any close began. It sets halt, and waits
   for ready: once ready resolves and no close began, it closes gracefully. *)
SignalAborts ==
  /\ ~sig /\ chain /= "notStarted" /\ closeState = "none"
  /\ sig' = TRUE
  /\ halt' = TRUE
  /\ IF ready = "resolved"
       THEN /\ closeState' = "hooks2" /\ closeMode' = "graceful"
       ELSE UNCHANGED <<closeState, closeMode>>
  /\ firstStop' = IF firstStop = "none" /\ ready = "pending" THEN "signal" ELSE firstStop
  /\ stopSeen' = (stopSeen \/ ready = "pending")
  /\ UNCHANGED <<h1, h2, port1, port2, preAborted, claimed, chain, realError, ready,
                 readyReason, pendingReject, closed, ranCloseHooks, badAfterWork, badHookStart>>

(* The app calls close(): it claims a start under way (end(CLOSING) waits for this close, then
   rejects ready), drops the signal's listener, and runs the close hooks. A later close returns
   the first one's Result, so only the first is a step. A stop signal that came first stays the
   cause, and the close is forced (stopStart returns true). *)
UserCloses(mode) ==
  /\ chain /= "notStarted" /\ closeState = "none"
  /\ closeState' = "hooks2"
  /\ IF chain = "running" /\ ~claimed
       THEN /\ claimed' = TRUE
            /\ pendingReject' = IF halt THEN "signal" ELSE "closing"
            /\ closeMode' = IF halt THEN "forced" ELSE mode
       ELSE /\ closeMode' = mode
            /\ UNCHANGED <<claimed, pendingReject>>
  /\ firstStop' = IF firstStop = "none" /\ ready = "pending" THEN "close" ELSE firstStop
  /\ stopSeen' = (stopSeen \/ ready = "pending")
  /\ UNCHANGED <<h1, h2, port1, port2, preAborted, sig, halt, chain, realError, ready,
                 readyReason, closed, ranCloseHooks, badAfterWork, badHookStart>>

CloseHookRuns(c) ==
  /\ closeState = IF c = 2 THEN "hooks2" ELSE "hooks1"
  /\ closeState' = IF c = 2 THEN "hooks1" ELSE "layer"
  /\ IF c = 1 THEN port1' = FALSE /\ port2' = port2 ELSE port2' = FALSE /\ port1' = port1
  /\ ranCloseHooks' = ranCloseHooks \cup {c}
  /\ UNCHANGED <<h1, h2, preAborted, sig, halt, claimed, chain, closeMode, realError, ready,
                 readyReason, pendingReject, closed, firstStop, stopSeen, badAfterWork,
                 badHookStart>>

(* closeLayer ends, `closed` settles with Core's Result (ADR 0028: a real error is failed,
   else forced is cancelled, graceful is success), and a waiting end() rejects ready. *)
ScopeCloses ==
  /\ closeState = "layer"
  /\ closeState' = "done"
  /\ closed' = IF realError THEN "failed"
               ELSE IF closeMode = "forced" THEN "cancelled" ELSE "success"
  /\ IF pendingReject /= "none"
       THEN ready' = "rejected" /\ readyReason' = pendingReject
       ELSE UNCHANGED <<ready, readyReason>>
  /\ UNCHANGED <<h1, h2, port1, port2, preAborted, sig, halt, claimed, chain, closeMode,
                 realError, pendingReject, ranCloseHooks, firstStop, stopSeen, badAfterWork,
                 badHookStart>>

\* The end: closed, and no start hook still runs.
Done ==
  /\ closeState = "done" /\ h1 /= "before" /\ h2 /= "before"
  /\ UNCHANGED vars

Next ==
  \/ ScopeStarts
  \/ Hook1CallsNext
  \/ Hook2CallsNext
  \/ HookThrows(1) \/ HookThrows(2)
  \/ StartTimesOut
  \/ SignalAborts
  \/ UserCloses("forced") \/ UserCloses("graceful")
  \/ CloseHookRuns(2) \/ CloseHookRuns(1)
  \/ ScopeCloses
  \/ Done

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
\* RULES

\* ADR 0134 decision 1: after a stop, next() rejects, so no hook does the work after its next().
NoWorkAfterStop == ~badAfterWork

\* ADR 0134 decision 1: a hook that has not started does not start (after a stop).
NoHookStartsAfterStop == ~badHookStart

\* ADR 0134 decision 2: a stop signal during start: the close is forced, and the close hooks run.
SignalForcesClose ==
  (firstStop = "signal" /\ closeState = "done") => (closeMode = "forced" /\ ranCloseHooks = {1, 2})

\* ADR 0134 decision 2: `closed` is `cancelled` after a stop signal during start.
SignalClosedCancelled ==
  (firstStop = "signal" /\ closed /= "pending") => closed = "cancelled"

\* ADR 0134 decision 2 (kept by ADR 0165 decision 2): a start error that comes first still wins.
FirstErrorWins ==
  (firstStop = "error" /\ ready = "rejected") => readyReason = "error"

(* ADR 0165 decision 2 (amends ADR 0134 decision 2; ADR 0085 decision 4): the first event that
   ends the start is its cause: a stop signal (also one aborted before start), a start hook's
   throw, a start timeout, or a close(). `ready` rejects with that cause. *)
Causes == {"pre", "signal", "error", "timeout", "close"}
ReasonOf(c) ==
  CASE c \in {"pre", "signal"} -> "signal"
    [] c = "close" -> "closing"
    [] OTHER -> c
StatusOf(c) == IF c \in {"error", "timeout"} THEN "failed" ELSE "cancelled"

(* ADR 0165 decision 1: `settled` is the twin of `ready`. On main it does not exist; the model
   reads it as the fix builds it, from ready: success with the handle, or the reason ready
   rejects with, as cancelled (a signal, a close) or failed (a start error, a timeout).
   It never rejects: it has no "rejected" value. *)
Settled ==
  CASE ready = "pending" -> "pending"
    [] ready = "resolved" -> "success"
    [] readyReason \in {"signal", "closing"} -> "cancelled"
    [] OTHER -> "failed"

\* ADR 0165 decision 2: ready rejects with the first cause, in both orders.
FirstCauseRejectsReady ==
  /\ firstStop \in Causes => ready /= "resolved"
  /\ (firstStop \in Causes /\ ready = "rejected") => readyReason = ReasonOf(firstStop)

\* ADR 0165 decisions 1 and 2: settled names the same cause, and its status matches it.
SettledNamesFirstCause ==
  /\ Settled \in {"pending", "success", "cancelled", "failed"}
  /\ (firstStop = "none" /\ Settled /= "pending") => Settled = "success"
  /\ (firstStop \in Causes /\ Settled /= "pending")
       => (Settled = StatusOf(firstStop) /\ readyReason = ReasonOf(firstStop))

\* ADR 0165 decision 2: a later error is dropped. Only a first error or timeout fails the start.
LaterErrorDropped ==
  /\ (firstStop \in {"pre", "signal", "close"} /\ ready = "rejected")
       => readyReason \notin {"error", "timeout"}
  /\ Settled = "failed" => firstStop \in {"error", "timeout"}

(* ADR 0165 decision 2, amended (Duke 2026-11-21 14:58 UTC): `closed` names the same first cause
   as `settled`. A start error or a timeout that came first fails it. A stop signal or a close
   that came first never does: a later error is dropped. The close's mode still picks
   cancelled (forced) or success (graceful), as ADR 0028 says. *)
ClosedFollowsFirstCause ==
  (firstStop \in Causes /\ closed /= "pending")
    => closed = IF StatusOf(firstStop) = "failed" THEN "failed"
                ELSE IF closeMode = "forced" THEN "cancelled" ELSE "success"

\* ADR 0134 decision 3: a signal that aborted before start: no hook runs.
PreAbortedRunsNoHook ==
  preAborted => (h1 = "idle" /\ h2 = "idle")

\* ADR 0085 decision 4: ready rejects only after the forced close ends (close hooks ran).
ReadyRejectsAfterClose ==
  ready = "rejected" => (closeState = "done" /\ ranCloseHooks = {1, 2})

\* ADR 0134 Results ("Any capsule that opens something after next() is safe") and its
\* Context (0.16.1: "nothing closes the port"): once `closed` settles, no port stays open.
NoPortAfterClosed ==
  closed /= "pending" => (~port1 /\ ~port2)
=============================================================================
