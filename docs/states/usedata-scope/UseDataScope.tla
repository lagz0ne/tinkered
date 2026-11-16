------------------------------ MODULE UseDataScope ------------------------------
(* <ScopeProvider scope={s}><Child/></ScopeProvider>, Child calls useData(cell).
   Describes @tinkered/react on origin/main 3ff67780:
   - ScopeProvider (packages/react/src/index.ts:152-164): bound = useMemo(bind(scope), [scope]);
     provide() keys the context provider with bound.key (index.ts:60). A new scope gives a new
     Bound, so a new key, so React mounts the subtree again. The same scope keeps the key.
   - useData -> useHeld (index.ts:347-355): use(ScopeContext) in the first render only; later
     renders return the held Bound.
   - useDataStore (index.ts:316-337): each render calls held.bound.scope.controller(cell);
     core's ensureOpen (packages/core/src/index.ts:1778, 5078) raises Disposed on a closed scope.
   A render that raises throws its work away; an error boundary inside the subtree shows. *)
EXTENDS FiniteSets

CONSTANTS Scopes   \* e.g. {"A", "B"}

None == "none"

VARIABLES
  given,     \* the scope the provider gives now (its committed prop)
  child,     \* "gone", "fresh" (mounted, not rendered yet), "shows", "failed" (raised Disposed)
  held,      \* the scope the child holds from its first render
  lastRead,  \* the scope the child's latest render asked for its controller
  result,    \* that render's outcome: "none", "value", "Disposed"
  stale,     \* a render returned a value from a closed scope
  closed,    \* scopes that closed
  due        \* React must render the child

vars == <<given, child, held, lastRead, result, stale, closed, due>>

Init == given = None /\ child = "gone" /\ held = None /\ lastRead = None
        /\ result = "none" /\ stale = FALSE /\ closed = {} /\ due = FALSE

\* The app renders the provider with scope s (the same one or another). useMemo keeps the
\* Bound, and so the key, for the same scope; a new scope gets a new key and React mounts the
\* subtree again. With the same key the child renders again and keeps what it holds.
ProviderGives(s) ==
  /\ ~due
  /\ given' = s
  /\ IF s # given
       THEN child' = "fresh" /\ held' = None /\ lastRead' = None /\ result' = "none"
       ELSE UNCHANGED <<child, held, lastRead, result>>
  /\ due' = (s # given \/ child = "shows")
  /\ UNCHANGED <<stale, closed>>

\* The child renders: on its first render it reads the context; later it uses what it holds.
\* Each render asks the held scope for the cell's controller.
ChildRenders ==
  /\ child \in {"fresh", "shows"}
  /\ LET h == IF child = "fresh" THEN given ELSE held
     IN /\ lastRead' = h
        /\ IF h \in closed
             THEN /\ result' = "Disposed" /\ child' = "failed"
                  /\ held' = IF child = "fresh" THEN None ELSE held  \* a raised first render keeps no ref
             ELSE /\ result' = "value" /\ child' = "shows" /\ held' = h
        /\ stale' = (stale \/ (result' = "value" /\ h \in closed))
  /\ due' = FALSE
  /\ UNCHANGED <<given, closed>>

\* The app closes scope s.
ScopeCloses(s) ==
  /\ ~due /\ s \notin closed
  /\ closed' = closed \cup {s}
  /\ UNCHANGED <<given, child, held, lastRead, result, stale, due>>

Next == (\E s \in Scopes : ProviderGives(s)) \/ ChildRenders \/ (\E s \in Scopes : ScopeCloses(s))

Spec == Init /\ [][Next]_vars

-------------------------------------------------------------------------------
\* ADR 0144, Decisions 1 and 2 ("It holds the result for the life of its component"; "Each provider
\* keys its subtree with what it provides"): a child never reads from a scope other than the one
\* its provider gives now.
ReadsGivenScope == lastRead \in {None, given}

\* ADR 0144, Decision 2 ("A new scope mounts the subtree again"): when the provider gives a new
\* scope, the child is mounted again (it holds nothing until its first render reads the context).
NewScopeRemounts == [][given' # given => child' = "fresh" /\ held' = None]_vars

\* ADR 0144, Decision 3 ("a render after the scope closed raises Disposed, as before"): a render
\* from a closed scope raises Disposed and never returns a stale value.
ClosedRaisesDisposed == /\ ~stale
                        /\ (lastRead \in closed /\ child = "failed") => result = "Disposed"
=============================================================================
