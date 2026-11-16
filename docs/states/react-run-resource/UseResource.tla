---------------------------- MODULE UseResource ----------------------------
(* useResource, as the code on origin/main c9c88174 has it:
   packages/react/src/index.ts ResourceOwner 495 (refetch 520, effect 527,
   query 556), useResource 615, readSuspended 666, readQuery 684,
   useSettled 702. Core builds once per owner and keeps a rejected build
   until release (ADR 0032 d1). One component reads one resource, in
   suspense mode (with a Suspense and an error boundary above it) or in
   query mode ({ suspense: false }). A build is sync or async, and may
   fail. The scope can change: a new Bound mounts the component again
   (ADR 0144 d2). At most MaxBuilds builds. Mode is fixed per config. *)
EXTENDS Naturals

CONSTANTS MaxBuilds, Mode

VARIABLES
  mode,      \* suspense or query
  b,         \* the build at the owner: none, pending, ok, failed
  async,     \* the build gave a promise
  published, \* query: what the effect published for this promise: none, ok, failed
  view,      \* what shows: blank, fallback, value, boundary, pending, success, error
  builds,    \* builds so far (bound)
  oldLate,   \* a build of the old scope is still in flight
  \* ghost variables, for the rules only
  released,  \* a release came since the build failed
  stale      \* the view showed a result of the old scope's build

vars == <<mode, b, async, published, view, builds, oldLate, released, stale>>

Init ==
  /\ mode = Mode
  /\ b = "none" /\ async = FALSE /\ published = "none" /\ view = "blank"
  /\ builds = 0 /\ oldLate = FALSE /\ released = FALSE /\ stale = FALSE

(* What a render shows for a build (readSuspended 667, readQuery 680). *)
Shows(m, bb, as, pub) ==
  IF m = "suspense"
    THEN CASE bb = "pending" -> "fallback" [] bb = "ok" -> "value" [] OTHER -> "boundary"
    ELSE IF ~as THEN (IF bb = "ok" THEN "success" ELSE "error")
         ELSE CASE pub = "ok" -> "success" [] pub = "failed" -> "error" [] OTHER -> "pending"

(* A render that starts a new build (core builds when the owner has none):
   sync value, sync throw, or a promise. *)
NewBuild ==
  /\ builds < MaxBuilds
  /\ \E nb \in {"ok", "failed", "pending"} :
       /\ b' = nb /\ async' = (nb = "pending")
       /\ view' = Shows(mode, nb, nb = "pending", "none")
  /\ builds' = builds + 1 /\ published' = "none"

(* The first render, on mount. *)
FirstRender ==
  /\ view = "blank" /\ b = "none" /\ ~oldLate
  /\ NewBuild
  /\ UNCHANGED <<mode, oldLate, released, stale>>

(* Suspense: the promise settled; React renders the child again, and `use`
   returns the value or throws the rejection to the boundary. *)
ReactRetries ==
  /\ mode = "suspense" /\ view = "fallback" /\ b \in {"ok", "failed"}
  /\ view' = Shows(mode, b, async, published)
  /\ UNCHANGED <<mode, b, async, published, builds, oldLate, released, stale>>

(* The async build settles. Query: the effect's then (526) publishes, and
   forces a render. *)
BuildSettles(r) ==
  /\ b = "pending"
  /\ b' = r
  /\ released' = FALSE
  /\ IF mode = "query"
       THEN /\ published' = r /\ view' = Shows(mode, r, TRUE, r)
       ELSE UNCHANGED <<published, view>>
  /\ UNCHANGED <<mode, async, builds, oldLate, stale>>

(* Query: refetch (520) releases the build and forces a render, which
   builds again. *)
YouRefetch ==
  /\ mode = "query" /\ b # "none"
  /\ NewBuild
  /\ released' = TRUE
  /\ UNCHANGED <<mode, oldLate, stale>>

(* Suspense: useRelease() on the failed build (ADR 0032 d4). *)
YouRelease ==
  /\ mode = "suspense" /\ b = "failed" /\ view = "boundary"
  /\ b' = "none" /\ released' = TRUE
  /\ UNCHANGED <<mode, async, published, view, builds, oldLate, stale>>

(* Suspense: you reset the error boundary; it renders the child again. A
   failed build that was not released throws again (sticky). *)
YouResetBoundary ==
  /\ mode = "suspense" /\ view = "boundary"
  /\ IF b = "none"
       THEN NewBuild
       ELSE /\ view' = Shows(mode, b, async, published)
            /\ UNCHANGED <<b, async, published, builds>>
  /\ UNCHANGED <<mode, oldLate, released, stale>>

(* A new scope: a new Bound mounts the component again (ADR 0144 d2): a new
   owner, a new build. The old build may still be in flight; the model lets it
   settle before the new mount renders, to keep the chart small. *)
ScopeChanges ==
  /\ b # "none" /\ view # "blank"
  /\ oldLate' = (b = "pending")
  /\ b' = "none" /\ async' = FALSE /\ published' = "none" /\ view' = "blank"
  /\ released' = TRUE
  /\ UNCHANGED <<mode, builds, stale>>

(* The old scope's build settles. Its observer was cleaned up (effect 544). *)
OldBuildSettles ==
  /\ oldLate
  /\ oldLate' = FALSE
  /\ UNCHANGED <<mode, b, async, published, view, builds, released, stale>>

Next ==
  \/ FirstRender \/ ReactRetries \/ YouRefetch \/ YouRelease \/ YouResetBoundary \/ ScopeChanges
  \/ OldBuildSettles
  \/ BuildSettles("ok") \/ BuildSettles("failed")
  \/ (UNCHANGED vars /\ builds = MaxBuilds)

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
(* Rules. Each one is a line of an ADR. *)

(* ADR 0032 d1: a rejected build is sticky, cached at the owner until
   release or close; a retry reuses that rejection, not a fresh build. *)
FailedBuildSticks ==
  [][(b = "failed" /\ b' # "failed") => released']_vars

(* ADR 0032 d1: the retry reuses the rejection "instead of rebuilding a
   fresh, never-settling promise (which would hang on the fallback)". So a
   render of a failed build shows the error boundary. *)
FailedNeverHangs ==
  [][(mode = "suspense" /\ b = "failed" /\ b' = "failed" /\ view' # view)
       => view' = "boundary"]_vars

(* ADR 0032 d3: { suspense: false } "never suspends or throws". *)
QueryNeverSuspendsOrThrows == mode = "query" => view \notin {"fallback", "boundary"}

(* ADR 0144 d2: a new Bound mounts the subtree again. So the view never
   shows the old scope's build after the change. The model copies the
   observer's cleanup (effect 544), so this cannot fail here. *)
NoOldScopeResult == ~stale
=============================================================================
