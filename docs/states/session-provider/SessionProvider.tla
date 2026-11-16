---------------------------- MODULE SessionProvider ----------------------------
(* <StrictMode><ScopeProvider><Suspense><SessionProvider><Child/></SessionProvider></Suspense>
   </ScopeProvider></StrictMode>. Child calls useResource(r), r an async target:"session"
   resource. Describes @tinkered/react on origin/main 3ff67780:
   - SessionProvider (packages/react/src/index.ts:176-203): first render gives null; a passive
     effect (deps [parent, inherited]) calls parent.createSession() and setOwned; its cleanup
     setOwned(undefined) and closes that session.
   - useResource (index.ts:605-673): scope.resolve(r) starts the build once per session and
     returns its promise; use(promise) suspends.
   - React 19.3 dev: a fresh mount runs setup, then StrictMode runs cleanup + setup again.
     A sync update that suspends inside a shown Suspense boundary hides the content and shows the
     fallback; hidden content keeps its passive effects. When the data loads React renders again
     and shows the content; in StrictMode it then runs cleanup + setup of each effect in the
     content that reappears (seen in tests/statechart/probe.test.tsx).
   Sessions recycle a small set of slots so the state graph is finite; a closed slot is free. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Slots,   \* session slots, e.g. {1, 2}
          Strict   \* TRUE: the tree is under <StrictMode>

NoSession == 0

VARIABLES
  mounted,   \* the provider is on the page
  shown,     \* what the Suspense boundary shows: "nothing", "content" or "fallback"
  eff,       \* the provider's effect: "off", "due" (committed, setup not run), "on"
  replay,    \* StrictMode owes this effect a cleanup + setup
  owned,     \* the session the provider holds (its state and its effect's closure)
  renderDue, \* React must render the provider's subtree again
  sess,      \* [Slots -> {"free", "live", "closed"}]
  closes,    \* [Slots -> Nat]: times this session was closed
  build      \* [Slots -> {"none", "pending", "ready"}]: the session's async resource

vars == <<mounted, shown, eff, replay, owned, renderDue, sess, closes, build>>

Live == {s \in Slots : sess[s] = "live"}

Init ==
  /\ mounted = FALSE /\ shown = "nothing" /\ eff = "off" /\ replay = FALSE
  /\ owned = NoSession /\ renderDue = FALSE
  /\ sess = [s \in Slots |-> "free"] /\ closes = [s \in Slots |-> 0]
  /\ build = [s \in Slots |-> "none"]

\* React flushes pending passive effects before it starts any new render.
Flushed == eff = "on" /\ ~replay

\* Close session s (closeScope: close starts now; core aborts its build).
Close(s) ==
  /\ sess' = [sess EXCEPT ![s] = "closed"]
  /\ closes' = [closes EXCEPT ![s] = @ + 1]
  /\ build' = [build EXCEPT ![s] = "none"]

\* Free slots for a new session (core's createSession), not the one just closed.
FreeSlots(sx, old) == {s \in Slots : sx[s] # "live" /\ s # old}

\* The page mounts the tree. SessionProvider's first render gives null; React commits it.
PageMounts ==
  /\ ~mounted /\ eff = "off"
  /\ mounted' = TRUE /\ shown' = "content" /\ eff' = "due" /\ replay' = Strict
  /\ UNCHANGED <<owned, renderDue, sess, closes, build>>

\* Effect setup after a commit: open a session, setOwned.
EffectSetup ==
  /\ mounted /\ eff = "due"
  /\ \E s \in FreeSlots(sess, NoSession) : s = (CHOOSE x \in FreeSlots(sess, NoSession) : TRUE)
       /\ sess' = [sess EXCEPT ![s] = "live"]
       /\ closes' = [closes EXCEPT ![s] = 0]
       /\ build' = [build EXCEPT ![s] = "none"]
       /\ owned' = s
  /\ eff' = "on" /\ renderDue' = TRUE
  /\ UNCHANGED <<mounted, shown, replay>>

\* StrictMode runs the effect's cleanup (close, setOwned(undefined)) then its setup (open, setOwned).
StrictRemount ==
  /\ mounted /\ eff = "on" /\ replay
  /\ LET old == owned
         afterClose == [sess EXCEPT ![old] = "closed"]
     IN \E s \in FreeSlots(afterClose, old) :
        /\ s = (CHOOSE x \in FreeSlots(afterClose, old) : TRUE)
        /\ sess' = [afterClose EXCEPT ![s] = "live"]
        /\ closes' = [closes EXCEPT ![old] = @ + 1, ![s] = 0]
        /\ build' = [build EXCEPT ![old] = "none", ![s] = "none"]
        /\ owned' = s
  /\ replay' = FALSE /\ renderDue' = TRUE
  /\ UNCHANGED <<mounted, shown, eff>>

\* React renders the subtree. The child resolves the resource from the owned session.
Render ==
  /\ mounted /\ Flushed /\ renderDue /\ owned # NoSession
  /\ IF build[owned] = "ready"
       THEN \* the child shows; if it was hidden it reappears, and StrictMode replays effects
            /\ shown' = "content"
            /\ replay' = (Strict /\ shown = "fallback")
            /\ UNCHANGED build
       ELSE \* the build starts (once per session); use(promise) suspends: show the fallback
            /\ build' = [build EXCEPT ![owned] = "pending"]
            /\ shown' = "fallback"
            /\ UNCHANGED replay
  /\ renderDue' = FALSE
  /\ UNCHANGED <<mounted, eff, owned, sess, closes>>

\* The session's async resource settles. React pings the boundary if it waits on it.
DataLoads ==
  /\ \E s \in Slots :
       /\ sess[s] = "live" /\ build[s] = "pending"
       /\ build' = [build EXCEPT ![s] = "ready"]
       /\ renderDue' = (renderDue \/ (s = owned /\ shown = "fallback"))
  /\ UNCHANGED <<mounted, shown, eff, replay, owned, sess, closes>>

\* The component above re-renders with the same scope. The provider and child render again.
ParentRerenders ==
  /\ mounted /\ Flushed /\ ~renderDue
  /\ renderDue' = TRUE
  /\ UNCHANGED <<mounted, shown, eff, replay, owned, sess, closes, build>>

\* The page removes the tree. The effect cleanup closes the owned session.
PageUnmounts ==
  /\ mounted /\ Flushed
  /\ Close(owned)
  /\ mounted' = FALSE /\ shown' = "nothing" /\ eff' = "off" /\ replay' = FALSE
  /\ owned' = NoSession /\ renderDue' = FALSE

ReactSteps == EffectSetup \/ StrictRemount \/ Render \/ DataLoads

Next == PageMounts \/ EffectSetup \/ StrictRemount \/ Render \/ DataLoads
        \/ ParentRerenders \/ PageUnmounts

\* React's own steps are fair; the page's steps (mount, unmount, re-render) are not.
Spec == Init /\ [][Next]_vars
        /\ WF_vars(EffectSetup) /\ WF_vars(StrictRemount) /\ WF_vars(Render) /\ WF_vars(DataLoads)

-------------------------------------------------------------------------------
\* The provider is at rest: effects flushed, nothing left to render, the child shows its data.
Stable == mounted /\ Flushed /\ ~renderDue /\ shown = "content"
          /\ owned # NoSession /\ build[owned] = "ready"

\* ADR 0031, Decision bullet 2 ("SessionProvider creates a child session on mount ... A React
\* subtree's mount lifetime is a core session lifetime") and Consequences bullet 3 ("the guard only
\* prevents double-creation within a single committed mount"): a mounted provider at rest has one
\* live session, the one it holds.
OneLiveSession == (mounted /\ Flushed) => Live = {owned}

\* ADR 0031, Decision bullet 4 ("On a StrictMode remount the prior session is already closed") and
\* Consequences bullet 3 ("closed by its cleanup like any other"): each session is closed at most once.
ClosedOnce == \A s \in Slots : closes[s] <= 1

\* ADR 0031, Decision bullet 2 ("closes it on unmount") and Consequences bullet 3 ("so no session
\* leaks"): after the provider unmounts, no session is live.
NoLeakAfterUnmount == ~mounted => Live = {}

\* ADR 0031, Context ("must survive that faithfully, not merely tolerate it") and Decision bullet 4
\* ("The dev-only create/close/create cycle is accepted"; one cycle, not a loop); ADR 0124 Lifecycle,
\* card react/strict-session-suspense ("renders ok with one build"): a mounted provider reaches a
\* stable state while it stays mounted.
ReachesStable == mounted ~> (Stable \/ ~mounted)
=============================================================================
