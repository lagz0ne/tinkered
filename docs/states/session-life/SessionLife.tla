---------------------------- MODULE SessionLife ----------------------------
(* A root scope R with one capsule close hook, a child session S with a body, and a
   grandchild session G that S's body may open and awaits. Each layer has defers:
   R has r1 then r2 (registered before), S and G each register one in their body.
   Code: packages/core/src/index.ts on origin/main c9c88174 (same lines as 3ff67780):
     ensureOpen 1778, ensureRunning 1795, makeLayer 4290, markSwept 4373,
     markAborted 4386, abortSubtree 4396, settleOutcome 4420, closeLayer 4543,
     startClose 4614 (first / run / tail), finishLayer 4771, runSessionWith 4811,
     endSession 4860, settleSessionWith 4886, propagateSweptOutcome 5356,
     ScopeHandle.onClose 5211, ScopeHandle.close 5223, watchRootClose 6785,
     closeWouldReenter 2800, closeEach 6996.
   One step is one JS job that no outside event can split. A body end and its
   forced self-close (settleSessionWith) are one step. A forced close's abort lands
   one microtask after the close call (READY.then(first)): that is its own step.
   Constants are fixed: one child per layer, one defer per session. *)
EXTENDS Naturals, Sequences, FiniteSets

Layers == {"R", "S", "G"}
Child(l) == CASE l = "R" -> "S" [] l = "S" -> "G" [] OTHER -> "none"
Parent(l) == CASE l = "S" -> "R" [] l = "G" -> "S" [] OTHER -> "none"
Desc(l) == CASE l = "R" -> {"S", "G"} [] l = "S" -> {"G"} [] OTHER -> {}
Anc(l) == CASE l = "S" -> {"R"} [] l = "G" -> {"R", "S"} [] OTHER -> {}
DefersOf(l) == CASE l = "R" -> <<"r2", "r1">> [] l = "S" -> <<"s">> [] OTHER -> <<"g">>

VARIABLES
  cl,          \* cl[l]: none (not made), open, hooks (root close hooks run), closing, closed
  shut,        \* shut[l]: Layer.closed (sealed for writes and handle verbs)
  md,          \* md[l]: none, forced, graceful: the mode of the close that runs
  pend,        \* pend[l]: a forced close was called; its abort lands next microtask
  ab,          \* ab[l]: Layer.aborted (ctx.signal aborted)
  sw,          \* sw[l]: Layer.swept (an ancestor close collects this layer)
  fired,       \* fired[l]: this layer's own closing controller fired (ctx.closing)
  body,        \* body[l]: none, run, ok, threw, cancelled (Layer.bodyDone once ended)
  childErr,    \* childErr[l]: Layer.childError (a swept child's failure)
  res,         \* res[l]: none, success, cancelled, failed: the close Result
  seen,        \* seen[l]: the end status the layer's defers got
  log,         \* defer ids in the order they ran
  hook,        \* the root close hook: none, pending (runs, before next), ran
  hookRuns,    \* times the root close hook ran
  life,        \* lifetime.closing is set: a root close() was taken
  firstAsk,    \* the mode of the first close() call on R: none, forced, graceful
  catches,     \* S's body catches G's rejection (fixed per run)
  reenter,     \* S's defer calls root.close() (fixed per run)
  threw,       \* ghost: the layer's own body threw
  cut,         \* ghost: the body settled after its layer's abort (interrupted)
  failSwept,   \* ghost: the layer ended failed while swept (it pushes up)
  late         \* ghost: a leaked S handle verb was taken after S's body ended

vars == <<cl, shut, md, pend, ab, sw, fired, body, childErr, res, seen, log, hook,
          hookRuns, life, firstAsk, catches, reenter, threw, cut, failSwept, late>>

Init ==
  /\ cl = [l \in Layers |-> IF l = "G" THEN "none" ELSE "open"]
  /\ shut = [l \in Layers |-> FALSE]
  /\ md = [l \in Layers |-> "none"]
  /\ pend = [l \in Layers |-> FALSE]
  /\ ab = [l \in Layers |-> FALSE]
  /\ sw = [l \in Layers |-> FALSE]
  /\ fired = [l \in Layers |-> FALSE]
  /\ body = [l \in Layers |-> IF l = "S" THEN "run" ELSE "none"]
  /\ childErr = [l \in Layers |-> FALSE]
  /\ res = [l \in Layers |-> "none"]
  /\ seen = [l \in Layers |-> "none"]
  /\ log = <<>>
  /\ hook = "none" /\ hookRuns = 0 /\ life = FALSE /\ firstAsk = "none"
  /\ catches \in BOOLEAN
  /\ reenter \in BOOLEAN
  /\ threw = [l \in Layers |-> FALSE]
  /\ cut = [l \in Layers |-> FALSE]
  /\ failSwept = [l \in Layers |-> FALSE]
  /\ late = FALSE

(* The close fields as one record, so a step can apply closeLayer to two layers. *)
Cur == [cl |-> cl, shut |-> shut, md |-> md, pend |-> pend, ab |-> ab, sw |-> sw,
        fired |-> fired]

SetClose(st) ==
  /\ cl' = st.cl /\ shut' = st.shut /\ md' = st.md /\ pend' = st.pend /\ ab' = st.ab
  /\ sw' = st.sw /\ fired' = st.fired

(* closeLayer 4543 + startClose 4614: a later close returns the first close's promise.
   Else: closed = force || aborted, the closing controller fires, the subtree is swept,
   and a forced close aborts the subtree one microtask later. *)
Start(st, l, force) ==
  IF st.cl[l] \in {"closing", "closed"} THEN st
  ELSE LET f == force \/ st.ab[l] IN
    [st EXCEPT !.cl[l] = "closing", !.shut[l] = f,
               !.md[l] = IF f THEN "forced" ELSE "graceful",
               !.fired[l] = TRUE, !.pend[l] = f,
               !.sw = [x \in Layers |->
                         IF x \in Desc(l) /\ st.cl[x] # "none" THEN TRUE ELSE st.sw[x]]]

Live(st, x) == st.cl[x] \in {"open", "hooks", "closing"}

(* abortSubtree 4396 / markAborted 4386: abort l and its live subtree; a layer already
   closing becomes sealed (closed). *)
AbortSub(st, l) ==
  [st EXCEPT
     !.ab = [x \in Layers |-> IF (x = l \/ x \in Desc(l)) /\ Live(st, x) THEN TRUE ELSE st.ab[x]],
     !.shut = [x \in Layers |->
                 IF (x = l \/ x \in Desc(l)) /\ Live(st, x) /\ ~st.ab[x] /\ st.cl[x] = "closing"
                 THEN TRUE ELSE st.shut[x]],
     !.pend[l] = FALSE]

Rollback(l) == md[l] = "forced" \/ body[l] = "threw" \/ childErr[l]

Others == <<childErr, res, seen, log, hook, hookRuns, life, firstAsk, catches, reenter,
            threw, cut, failSwept, late>>

(* S's body opens G with s.session(): ensureRunning(S) passes while S is not sealed and its
   body runs. makeLayer inherits swept and aborted. *)
BodyOpensGrandchild ==
  /\ cl["G"] = "none" /\ body["S"] = "run" /\ ~shut["S"]
  /\ cl' = [cl EXCEPT !["G"] = "open"]
  /\ body' = [body EXCEPT !["G"] = "run"]
  /\ sw' = [sw EXCEPT !["G"] = sw["S"]]
  /\ ab' = [ab EXCEPT !["G"] = ab["S"]]
  /\ UNCHANGED <<shut, md, pend, fired>> /\ UNCHANGED Others

(* A body ends. how: returns, throws (G only), stops (it honours its aborted signal).
   S awaits G. If G rejected and S does not catch, S rethrows. The body end is read as in
   settleSessionWith 4886; the session then force-closes itself (it has a defer, so it
   never ends in place). *)
Outcome(x, how) ==
  IF x = "S" /\ how = "returns" /\ res["G"] \in {"failed", "cancelled"} /\ ~catches
  THEN IF res["G"] = "cancelled" /\ ab["S"] THEN "cancelled" ELSE "threw"
  ELSE CASE how = "throws" -> "threw"
         [] how = "stops" -> "cancelled"
         [] OTHER -> IF ab[x] THEN "cancelled" ELSE "ok"

BodyEnds(x, how) ==
  /\ body[x] = "run"
  /\ x = "S" => cl["G"] \in {"none", "closed"}
  /\ how = "stops" => ab[x]
  /\ how = "throws" => x = "G"
  /\ LET out == Outcome(x, how) IN
       /\ body' = [body EXCEPT ![x] = out]
       /\ threw' = [threw EXCEPT ![x] = (out = "threw")]
       /\ cut' = [cut EXCEPT ![x] = (out = "cancelled")]
  /\ SetClose(Start(Cur, x, TRUE))
  /\ UNCHANGED <<childErr, res, seen, log, hook, hookRuns, life, firstAsk, catches, reenter,
                 failSwept, late>>

(* S's body calls close() on its own handle and goes on (it does not await it). *)
BodyClosesItsSession ==
  /\ body["S"] = "run" /\ cl["S"] = "open"
  /\ SetClose(Start(Cur, "S", TRUE))
  /\ UNCHANGED <<body>> /\ UNCHANGED Others

(* The app calls root.close(): watchRootClose 6785 takes lifetime.closing, sweeps the
   subtree, fires the closing signal, and runs the close hook before core's close. *)
AppClosesRoot(graceful) ==
  /\ ~life /\ cl["R"] = "open"
  /\ life' = TRUE
  /\ hook' = "pending"
  /\ firstAsk' = IF graceful THEN "graceful" ELSE "forced"
  /\ cl' = [cl EXCEPT !["R"] = "hooks"]
  /\ sw' = [x \in Layers |-> IF x = "R" \/ cl[x] # "none" THEN TRUE ELSE sw[x]]
  /\ fired' = [fired EXCEPT !["R"] = TRUE]
  /\ UNCHANGED <<shut, md, pend, ab, body, childErr, res, seen, log, hookRuns, catches,
                 reenter, threw, cut, failSwept, late>>

(* The close hook runs and calls next(): closeLayer(R, !graceful). *)
CloseHookRuns ==
  /\ hook = "pending"
  /\ hook' = "ran"
  /\ hookRuns' = hookRuns + 1
  /\ SetClose(Start(Cur, "R", firstAsk = "forced"))
  /\ UNCHANGED <<body, childErr, res, seen, log, life, firstAsk, catches, reenter, threw,
                 cut, failSwept, late>>

\* A forced close's abort lands (startClose first(): abortSubtree).
AbortLands(l) ==
  /\ pend[l]
  /\ SetClose(AbortSub(Cur, l))
  /\ UNCHANGED <<body>> /\ UNCHANGED Others

(* startClose run(): the body end is read, then closeEach closes the child, forced when this
   close is forced or failing. A child already closing keeps its own close. *)
CloseReachesChild(l) ==
  /\ cl[l] = "closing" /\ ~pend[l] /\ body[l] # "run"
  /\ Child(l) # "none"
  /\ cl[Child(l)] = "open"
  /\ SetClose(Start(Cur, Child(l), Rollback(l)))
  /\ UNCHANGED <<body>> /\ UNCHANGED Others

(* The drain: owned work joined, closed set, outcome read (settleOutcome), defers run last
   first, then finishLayer detaches and a swept layer pushes its failure up. S's defer may
   call root.close(): closeWouldReenter(R) is true, so watchRootClose skips the hooks and
   calls closeLayer(R, forced) at once. *)
Settled(l) ==
  IF body[l] = "threw" \/ childErr[l] THEN "failed"
  ELSE IF (IF l = "R" THEN Rollback(l) ELSE body[l] = "cancelled") THEN "cancelled"
  ELSE "success"

Drain(l) ==
  /\ cl[l] = "closing" /\ ~pend[l] /\ body[l] # "run"
  /\ Child(l) # "none" => cl[Child(l)] \in {"none", "closed"}
  /\ LET out == Settled(l)
         re == l = "S" /\ reenter
         st1 == IF re /\ cl["R"] \in {"open", "hooks"} THEN Start(Cur, "R", TRUE) ELSE Cur
         st2 == [st1 EXCEPT !.cl[l] = "closed", !.shut[l] = TRUE]
         p == Parent(l)
         push == p # "none" /\ st1.sw[l] /\ out = "failed"
     IN /\ SetClose(st2)
        /\ res' = [res EXCEPT ![l] = out]
        /\ seen' = [seen EXCEPT ![l] = out]
        /\ log' = log \o DefersOf(l)
        /\ childErr' = IF push THEN [childErr EXCEPT ![p] = TRUE] ELSE childErr
        /\ failSwept' = [failSwept EXCEPT ![l] = push]
        /\ life' = (life \/ re)
        /\ firstAsk' = IF re /\ firstAsk = "none" THEN "forced" ELSE firstAsk
  /\ UNCHANGED <<body, hook, hookRuns, catches, reenter, threw, cut, late>>

(* Code kept a leaked S handle and calls onClose on it after S's body ended
   (ScopeHandle.onClose 5211: ensureOpen reads Layer.closed only). *)
LeakedHandleOnClose ==
  /\ body["S"] \in {"ok", "threw", "cancelled"} /\ ~late
  /\ ~shut["S"]
  /\ late' = TRUE
  /\ UNCHANGED <<cl, shut, md, pend, ab, sw, fired, body, childErr, res, seen, log, hook,
                 hookRuns, life, firstAsk, catches, reenter, threw, cut, failSwept>>

Progress ==
  \/ BodyOpensGrandchild
  \/ \E x \in {"S", "G"}, how \in {"returns", "throws", "stops"} : BodyEnds(x, how)
  \/ BodyClosesItsSession
  \/ \E g \in BOOLEAN : AppClosesRoot(g)
  \/ CloseHookRuns
  \/ \E l \in Layers : AbortLands(l) \/ CloseReachesChild(l) \/ Drain(l)
  \/ LeakedHandleOnClose

Done == cl["R"] = "closed" /\ UNCHANGED vars

Next == Progress \/ Done

-----------------------------------------------------------------------------
(* Rules. Each names the ADR text it comes from. *)

Made(l) == cl[l] # "none"
Count(d) == Cardinality({i \in 1..Len(log) : log[i] = d})
Pos(d) == CHOOSE i \in 1..Len(log) : log[i] = d
InLog(d) == \E i \in 1..Len(log) : log[i] = d

\* ADR 0011 decision "Children first" (and ADR 0024 "children-first"): a layer's defers
\* run only after each child it made has closed.
ChildrenCloseFirst ==
  \A l \in Layers : res[l] # "none" =>
    (Child(l) # "none" => cl[Child(l)] \in {"none", "closed"})

\* ADR 0024 decision ("runs once when the entity's lifetime ends"), ADR 0029 decision 5
\* ("each cleanup still runs once"): no defer runs twice; a closed layer ran each of its defers.
EachDeferOnce ==
  /\ \A d \in {"r1", "r2", "s", "g"} : Count(d) <= 1
  /\ \A l \in Layers : cl[l] = "closed" =>
       \A i \in 1..Len(DefersOf(l)) : InLog(DefersOf(l)[i])

\* ADR 0026 decision 1, ADR 0011 "within a layer, teardown runs LIFO": r2 (registered last)
\* runs before r1.
LastDeferFirst == InLog("r1") => (InLog("r2") /\ Pos("r2") < Pos("r1"))

\* ADR 0028 decision 3 (reality-only reducer), with ADR 0026 decision 5 (a body settled before
\* the interrupt keeps its value) and ADR 0024 (a defer receives why the lifetime ended):
\* failed if the body threw or a swept child really failed (bubbled up); else cancelled if
\* the body was interrupted, or, with no body, the scope was force-closed; else success.
\* The Result and the end each defer saw both equal it.
Expected(l) ==
  IF threw[l] \/ (Child(l) # "none" /\ failSwept[Child(l)]) THEN "failed"
  ELSE IF (IF l = "R" THEN md[l] = "forced" ELSE cut[l]) THEN "cancelled"
  ELSE "success"

OutcomeIsReality ==
  \A l \in Layers : res[l] # "none" => (res[l] = Expected(l) /\ seen[l] = Expected(l))

\* ADR 0024 decision ("cancelling a parent cancels its subflows"), ADR 0028 Consequences
\* ("a failing/forced ancestor force-cascades to its subtree"): once a layer is aborted,
\* every live layer under it is aborted too.
CancelReachesChildren ==
  \A l \in Layers : ab[l] =>
    \A x \in Desc(l) : cl[x] \in {"open", "closing"} => ab[x]

\* ADR 0104 decision: a layer's closing signal aborts the moment it begins to close; a
\* child's closing signal also aborts when its parent's does.
ClosingFiresAtStart ==
  \A l \in Layers : cl[l] \in {"hooks", "closing", "closed"} =>
    (fired[l] \/ \E a \in Anc(l) : fired[a])

\* ADR 0104 decision ("Also from ADR 0085: a root's close hooks run once, cannot skip
\* cleanup"): the root close hook runs at most once, and a closed root ran it.
CloseHookRunsOnce == hookRuns <= 1 /\ (cl["R"] = "closed" => hookRuns = 1)

\* ADR 0029 decision 1 (and ADR 0028 Consequences): a later close() returns the in-flight
\* close's Result; the FIRST call's mode wins.
FirstModeWins == md["R"] # "none" => md["R"] = firstAsk

\* ADR 0071 decision 1: once the body has returned or settled, the handle is closed;
\* onClose, resolve, run and close on it throw Disposed.
HandleDeadAfterBody == ~late

\* ADR 0027 decision ("close() always resolves to a Result"): when nothing can step, no
\* close is left half done. Bodies here always honour their signal (ADR 0028 decision 1).
CloseAlwaysEnds ==
  (~ENABLED Progress) => \A l \in Layers : cl[l] \notin {"hooks", "closing"}

=============================================================================
