---------------------------- MODULE RunLife ----------------------------
(* One root scope L with one capsule run hook. The app runs `outer` (run A). The hook
   asks event.is(outer): for outer it calls next() once, twice, or not at all (it
   returns a stand-in value); for any other op it calls next() once. Each body of outer
   registers one ctx.defer, keeps its `deps.inner` controller (a leak), and calls `inner`
   (run B) once, and catches what B throws. B is called plain, with its own signal (a
   child session K, ADR 0090), or through settle with its own signal.
   Code: packages/core/src/index.ts on origin/main c9c88174 (same lines as 3ff67780):
     ensureRunning 1795, runFailure 2664, stick 2684, isCancel 2782, OperationCtx 2887,
     OperationCtx.share 2947, runTagged 2970, runOnce 3248, finishRun 3160,
     runSessionWith 4811 (call signal: `child.closed = true; abortSubtree`),
     settleSessionWith 4886, closeLayer 4543 (fires closeAbort), failedRun 5292,
     runHookCall 5519, closingOf 6063, runHookChain 7074, stepRunHook 7140,
     runHookBody 7164 (a second next(): new ctx, shares only the defer list),
     finishHookRun 7210, finishHookDone 7254 (clears `live` on the last ctx only).
   One step is one JS job. A sync body (and the hook around it) is one step. The app's
   close is graceful: a forced close seals the scope at once, so no late call gets in. *)
EXTENDS Naturals, FiniteSets

VARIABLES
  mode,        \* the hook for outer: once, twice, skip (fixed per run)
  kind,        \* how outer calls inner: plain, signal, settle (settle with a signal)
  a,           \* run A: hook (the hook runs), body (a body awaits B), ended, done
  bodies,      \* bodies of outer that ran (0, 1, 2)
  leakLive,    \* OperationCtx.live of the ctx whose deps.inner the first body kept
  isSeen,      \* what event.is(outer) answered per run: none, yes, no
  b,           \* run B: none, running, ended
  bRan,        \* B's body ran
  bOut,        \* how B ended: none, ok, panic, managed, own (its signal's reason), wrapped
  bSeen,       \* what outer got from B: none, value, rejected, success, failed, cancelled
  sig,         \* B's own signal is aborted
  k,           \* the child session K of a signal call: none, open, closed
  kFired,      \* K's closing signal (ctx.closing) is aborted
  panics,      \* errors stuck on L as panics (ADR 0067), by name
  defs,        \* times each body's defer ran: defs[i] for body i
  defSeen,     \* the end status outer's defers got
  lc,          \* L: open, closing (graceful, before the drain), closed
  stale,       \* the leaked deps.inner was called after A finished: none, refused, ran
  staleWhen,   \* L's state at that call
  preAborted,  \* ghost: B's signal was already aborted when outer called inner
  bSig         \* ghost: B's signal was aborted when B ended

vars == <<mode, kind, a, bodies, leakLive, isSeen, b, bRan, bOut, bSeen, sig, k, kFired,
          panics, defs, defSeen, lc, stale, staleWhen, preAborted, bSig>>

Init ==
  /\ mode \in {"once", "twice", "skip"}
  /\ kind \in {"plain", "signal", "settle"}
  /\ a = "hook" /\ bodies = 0 /\ leakLive = FALSE
  /\ isSeen = [r \in {"A", "B"} |-> "none"]
  /\ b = "none" /\ bRan = FALSE /\ bOut = "none" /\ bSeen = "none"
  /\ sig = FALSE /\ k = "none" /\ kFired = FALSE
  /\ panics = {}
  /\ defs = [i \in 1..2 |-> 0] /\ defSeen = "none"
  /\ lc = "open"
  /\ stale = "none" /\ staleWhen = "none"
  /\ preAborted = FALSE /\ bSig = FALSE

(* The hook runs for A: event.is(outer) is true. next() runs a body (runHookBody). With
   twice, body 1 runs and returns at once, then body 2 runs: run.ctx becomes body 2's ctx;
   body 1's ctx keeps live = true. Skip returns a stand-in and runs no body. *)
HookRuns ==
  /\ a = "hook"
  /\ isSeen' = [isSeen EXCEPT !["A"] = "yes"]
  /\ bodies' = CASE mode = "once" -> 1 [] mode = "twice" -> 2 [] OTHER -> 0
  /\ leakLive' = (mode # "skip")
  /\ a' = IF mode = "skip" THEN "ended" ELSE "body"
  /\ UNCHANGED <<mode, kind, b, bRan, bOut, bSeen, sig, k, kFired, panics, defs, defSeen,
                 lc, stale, staleWhen, preAborted, bSig>>

(* The caller aborts B's own signal (kind signal or settle). runSessionWith's listener:
   K.closed = true and abortSubtree(K, reason). K's closing controller is not fired. *)
CallerAbortsSignal ==
  /\ kind # "plain" /\ ~sig
  /\ sig' = TRUE
  /\ UNCHANGED <<mode, kind, a, bodies, leakLive, isSeen, b, bRan, bOut, bSeen, k, kFired,
                 panics, defs, defSeen, lc, stale, staleWhen, preAborted, bSig>>

(* The body of outer calls inner. ensureRunning(L, ctx) lets a live caller in during a
   graceful close. A signal that is already aborted rejects with its reason and starts no
   body (signal.throwIfAborted in runSessionWith). Else the hook runs for B: event.is(outer)
   is false, so it calls next(). *)
CallsInner ==
  /\ a = "body" /\ b = "none"
  /\ IF kind # "plain" /\ sig
       THEN /\ b' = "ended" /\ bOut' = "own"
            /\ bSeen' = IF kind = "settle" THEN "cancelled" ELSE "rejected"
            /\ UNCHANGED <<isSeen, bRan, k>>
       ELSE /\ b' = "running" /\ bRan' = TRUE
            /\ isSeen' = [isSeen EXCEPT !["B"] = "no"]
            /\ k' = IF kind = "plain" THEN "none" ELSE "open"
            /\ UNCHANGED <<bOut, bSeen>>
  /\ preAborted' = (kind # "plain" /\ sig)
  /\ UNCHANGED <<mode, kind, a, bodies, leakLive, sig, kFired, panics, defs, defSeen, lc,
                 stale, staleWhen, bSig>>

(* B ends. own: it rejects with its signal's reason; wrapped: an error that wraps it.
   With a signal, K reads the body end (settleSessionWith), closes itself (closeLayer
   fires K's closing), and the call settles from K's Result. The caller's runFailure
   skips only its own signal's reason (ADR 0133); stick skips a managed error. settle's
   failedRun answers cancelled for its own signal's reason, else failed, and recovers. *)
KEnd(o) ==
  CASE o = "own" -> "cancelled"
    [] o = "ok" -> IF sig THEN "cancelled" ELSE "success"
    [] OTHER -> "failed"

Rejection(o) == IF kind # "plain" /\ KEnd(o) = "cancelled" THEN "own" ELSE o

Sticks(o) ==
  LET e == Rejection(o) IN
    IF kind = "settle" \/ e \in {"ok", "managed"} THEN {}
    ELSE IF kind = "signal" /\ e = "own" /\ sig THEN {}
    ELSE {e}

Seen(o) ==
  LET e == Rejection(o) IN
    IF kind = "settle"
      THEN CASE e = "ok" -> "success" [] e = "own" /\ sig -> "cancelled" [] OTHER -> "failed"
      ELSE IF e = "ok" THEN "value" ELSE "rejected"

InnerEnds(o) ==
  /\ b = "running"
  /\ o \in {"own", "wrapped"} => (kind # "plain" /\ sig)
  /\ b' = "ended" /\ bOut' = o
  /\ bSeen' = Seen(o)
  /\ panics' = panics \cup Sticks(o)
  /\ k' = IF k = "open" THEN "closed" ELSE k
  /\ kFired' = (kFired \/ k = "open")
  /\ bSig' = sig
  /\ UNCHANGED <<mode, kind, a, bodies, leakLive, isSeen, bRan, sig, defs, defSeen, lc,
                 stale, staleWhen, preAborted>>

\* The body of outer caught what B threw and returns.
OuterBodyReturns ==
  /\ a = "body" /\ b = "ended"
  /\ a' = "ended"
  /\ UNCHANGED <<mode, kind, bodies, leakLive, isSeen, b, bRan, bOut, bSeen, sig, k, kFired,
                 panics, defs, defSeen, lc, stale, staleWhen, preAborted, bSig>>

(* finishHookRun: the shared defer list runs once, last first, with endFor(L, ok); then
   finishHookDone clears live on run.ctx only. With twice, body 1's ctx stays live. *)
OuterFinishes ==
  /\ a = "ended"
  /\ a' = "done"
  /\ defs' = [i \in 1..2 |-> IF i <= bodies THEN defs[i] + 1 ELSE defs[i]]
  /\ defSeen' = IF bodies > 0 THEN "success" ELSE "none"
  /\ leakLive' = (mode = "twice")
  /\ UNCHANGED <<mode, kind, bodies, isSeen, b, bRan, bOut, bSeen, sig, k, kFired, panics,
                 lc, stale, staleWhen, preAborted, bSig>>

\* The app calls close({ graceful: true }) on L.
AppClosesGracefully ==
  /\ lc = "open"
  /\ lc' = "closing"
  /\ UNCHANGED <<mode, kind, a, bodies, leakLive, isSeen, b, bRan, bOut, bSeen, sig, k,
                 kFired, panics, defs, defSeen, stale, staleWhen, preAborted, bSig>>

(* Code calls the leaked deps.inner after A finished. ensureRunning(L, ctx): a live ctx
   gets in while L is not sealed; else ensureAccepting refuses a closing scope. *)
LeakedSubflowCalled ==
  /\ a = "done" /\ bodies > 0 /\ stale = "none" /\ lc # "closed"
  /\ stale' = IF leakLive \/ lc = "open" THEN "ran" ELSE "refused"
  /\ staleWhen' = lc
  /\ UNCHANGED <<mode, kind, a, bodies, leakLive, isSeen, b, bRan, bOut, bSeen, sig, k,
                 kFired, panics, defs, defSeen, lc, preAborted, bSig>>

\* The graceful close joins A and B, drains, and seals L.
CloseEnds ==
  /\ lc = "closing" /\ a = "done" /\ b # "running"
  /\ lc' = "closed"
  /\ UNCHANGED <<mode, kind, a, bodies, leakLive, isSeen, b, bRan, bOut, bSeen, sig, k,
                 kFired, panics, defs, defSeen, stale, staleWhen, preAborted, bSig>>

Progress ==
  \/ HookRuns \/ CallerAbortsSignal \/ CallsInner
  \/ \E o \in {"ok", "panic", "managed", "own", "wrapped"} : InnerEnds(o)
  \/ OuterBodyReturns \/ OuterFinishes \/ AppClosesGracefully
  \/ LeakedSubflowCalled \/ CloseEnds

Done == lc = "closed" /\ UNCHANGED vars

Next == Progress \/ Done

-----------------------------------------------------------------------------
(* Rules. Each names the ADR text it comes from. *)

\* ADR 0133 decision 1: a call given a signal that rejects with that signal's reason, while
\* the signal is aborted, is a cancellation for its caller. It does not stick as a panic.
OwnSignalIsCancel == "own" \notin panics

\* ADR 0133 decisions 2 and 3, ADR 0067 ("a panic is sticky: it fails the layer it ran in
\* even if a caller catches it"): any other rejection, and an error that wraps the reason,
\* sticks on L although outer caught it (not through settle).
OtherRejectionSticks ==
  (b = "ended" /\ kind # "settle" /\ bOut \in {"panic", "wrapped"}) => bOut \in panics

\* ADR 0067 (As built, errors/t03): a run's managed error never fails a layer.
ManagedIsAValue == "managed" \notin panics

\* ADR 0067 decision ("settle recovers ... a panic received through settle does not fail
\* the layer"; Result success | failed | cancelled) with ADR 0133 decision 1 and ADR 0026
\* decision 5 (a body that settles after the interrupt is cancelled).
SettleRecovers ==
  (kind = "settle" /\ b = "ended") =>
    /\ panics = {}
    /\ bSeen = CASE bOut = "own" -> "cancelled"
                 [] bOut = "ok" -> IF bSig THEN "cancelled" ELSE "success"
                 [] OTHER -> "failed"

\* ADR 0024 decision ("an operation's defer runs when its run settles"; it "runs once"):
\* each body's defer runs once, after the run settled, and gets the run's end (success).
EachDeferOnceAtRunEnd ==
  /\ \A i \in 1..2 : defs[i] = IF a = "done" /\ i <= bodies THEN 1 ELSE 0
  /\ (a = "done" /\ bodies > 0) => defSeen = "success"

\* ADR 0050 decision 1: a hook that does not call next() short-circuits: no body runs.
NoNextNoBody == mode = "skip" => bodies = 0 /\ ~bRan

\* ADR 0142 decision 1: event.is(op) says if this run is op's.
IsNamesTheOp == isSeen["A"] \in {"none", "yes"} /\ isSeen["B"] \in {"none", "no"}

\* ADR 0090 decision: an already-aborted signal starts no body.
AbortedSignalStartsNoBody == preAborted => ~bRan

\* ADR 0104 decision ("A layer's closing signal aborts the moment that layer begins to
\* close, before Core waits for running work") with ADR 0090 ("An abort stops that child
\* and waits for its cleanup"): once B's own signal stopped K, K's closing signal is aborted.
ClosingFiresWhenStopped == (sig /\ k = "open") => kFired

\* ADR 0127 decision 2 ("after ... a close, a waiting call meets the closed scope, as a new
\* call would: run raises Disposed"; its Context: "a closing or closed scope refuses a new
\* call (Disposed, ADR 0028)"), with ADR 0028 decision 2 (graceful: in-flight work
\* finishes): only running work keeps its helpers. A run that finished is not running.
FinishedRunStartsNothing == ~(stale = "ran" /\ staleWhen = "closing")

=============================================================================
