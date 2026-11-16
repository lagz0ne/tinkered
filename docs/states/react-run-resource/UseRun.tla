------------------------------- MODULE UseRun -------------------------------
(* useRun, as the code on origin/main c9c88174 has it:
   packages/react/src/index.ts RunOwner 799 (attach 828, reset 848,
   finish 859, invoke 872), useRun 913. One component, one op, async runs
   only. It starts mounted, its layout effect run. It can be hidden by a Suspense boundary above it
   (React runs its layout cleanup, then its layout effect again on show),
   and can unmount. At most MaxCalls runs and resets in all. *)
EXTENDS Naturals, FiniteSets

CONSTANTS MaxCalls

VARIABLES
  mounted,   \* the component is mounted
  live,      \* code: owner.live (layout effect attached)
  status,    \* code: owner.state.status: idle, pending, success, error
  runId,     \* code: owner.runId
  calls,     \* runs and resets so far (bound)
  flight,    \* ids of runs in flight
  \* ghost variables, for the rules only
  want,      \* the state useMutation would show: [s |-> status, id |-> run]
  settled,   \* ids of runs that settled
  fired      \* ids of runs whose onSuccess/onError/onSettled fired

vars == <<mounted, live, status, runId, calls, flight, want, settled, fired>>

Init ==
  /\ mounted = TRUE /\ live = TRUE /\ status = "idle"
  /\ runId = 0 /\ calls = 0 /\ flight = {}
  /\ want = [s |-> "idle", id |-> 0] /\ settled = {} /\ fired = {}

(* attach 828: the layout effect runs (first mount, or a show after a
   Suspense hide); a state that is not idle goes back to idle. *)
Attach ==
  /\ mounted /\ ~live
  /\ live' = TRUE /\ status' = "idle"
  /\ UNCHANGED <<mounted, runId, calls, flight, want, settled, fired>>

(* invoke 872: run(input) from a click; the latest run publishes pending. *)
YouRun ==
  /\ mounted /\ live /\ calls < MaxCalls
  /\ runId' = runId + 1 /\ calls' = calls + 1
  /\ flight' = flight \cup {runId + 1}
  /\ status' = "pending"
  /\ want' = [s |-> "pending", id |-> runId + 1]
  /\ UNCHANGED <<mounted, live, settled, fired>>

(* finish 859: a run settles. Only while live: the latest run publishes,
   and the callbacks fire. *)
RunSettles(id, outcome) ==
  /\ id \in flight
  /\ flight' = flight \ {id}
  /\ settled' = settled \cup {id}
  /\ status' = IF live /\ runId = id THEN outcome ELSE status
  /\ fired' = IF live THEN fired \cup {id} ELSE fired
  /\ want' = IF want.id = id THEN [s |-> outcome, id |-> id] ELSE want
  /\ UNCHANGED <<mounted, live, runId, calls>>

(* reset 848 *)
YouReset ==
  /\ mounted /\ live /\ calls < MaxCalls
  /\ runId' = runId + 1 /\ calls' = calls + 1 /\ status' = "idle"
  /\ want' = [s |-> "idle", id |-> 0]
  /\ UNCHANGED <<mounted, live, flight, settled, fired>>

(* A Suspense boundary above hides the component: its layout cleanup runs. *)
SuspenseHides ==
  /\ mounted /\ live
  /\ live' = FALSE
  /\ UNCHANGED <<mounted, status, runId, calls, flight, want, settled, fired>>

(* The component unmounts: its layout cleanup runs; no run is aborted. *)
Unmount ==
  /\ mounted
  /\ mounted' = FALSE /\ live' = FALSE
  /\ UNCHANGED <<status, runId, calls, flight, want, settled, fired>>

Done == ~mounted /\ flight = {} /\ UNCHANGED vars

Next ==
  \/ Attach \/ YouRun \/ YouReset \/ SuspenseHides \/ Unmount \/ Done
  \/ \E id \in 1..MaxCalls : RunSettles(id, "success")
  \/ \E id \in 1..MaxCalls : RunSettles(id, "error")

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
(* Rules. Each one is a line of an ADR. *)

(* ADR 0032 d2: "options.onSuccess/onError/onSettled fire per run." *)
CallbacksFirePerRun == settled \subseteq fired

(* ADR 0032 d2: shaped like react-query's useMutation; "the outcome lands in
   state, variables is the call". So a shown component shows the state of
   its latest call: pending, its outcome, or idle after reset. *)
ShownStateIsLatest == (mounted /\ live) => status = want.s
=============================================================================
