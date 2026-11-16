---------------------------- MODULE ResourceLife ----------------------------
(* Two resources at one scope: A needs B. B needs nothing, or B needs A (a cycle, BReads = "A").
   Both factories take ctx, so every build has an instance (packages/core/src/index.ts on
   origin/main c9c88174, same lines as 3ff67780):
     instanceOf 3666, needsHold 3703, holdDependency 3709, unlinkInstance 3716,
     completeInstance 3743, finishInstance 3777, settleResourceInstance 3824,
     failResourceBuild 3849, buildResource 3903, buildTrackedResource 3929,
     resourceSlot 4113, invalidateResource 5570, drainReleasedOwner 5803,
     startClose 4613, closeInstancesSync 4689.
   A build is sync. One resolve, with the build of its dependency inside it, is one step:
   no other event can land inside it. A factory may call ctx.defer once (one end hook),
   then return a value or throw. *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS MaxResolves, MaxReleases, BReads   \* BReads: "none", or "A" for the cycle

Res == {"A", "B"}
Other(r) == IF r = "A" THEN "B" ELSE "A"
MaxInst == 2 * MaxResolves
Inst == 1..MaxInst
MaxHooks == 2 * MaxResolves
Hook == 1..MaxHooks

VARIABLES
  dep,        \* dep[r]: the resource r reads in `depends`, or "none". A reads B.
  node,       \* node[r]: "unbuilt" or "built" (NodeState.built)
  cur,        \* cur[r]: the instance on the node (NodeState.owned), 0 = none
  made,       \* instances made so far (ids 1..made)
  needs,      \* needs[i]: the instances i holds (ResourceInstance.needs)
  failed,     \* failed[i]: ResourceInstance.failed is set
  end,        \* end[i]: "none", "released", "failed", "close" (the close's own end)
  endBy,      \* endBy[i]: "none", "release", "close": what fixed the end (ghost)
  finished,   \* finished[i]: its hooks ran and its holds dropped (ghost: code has no field)
  hooks,      \* hooks[i]: the hook ids, in defer order
  nh,         \* hook ids used so far
  hookOk,     \* hookOk[h]: the build that deferred h returned a value
  hookEnd,    \* hookEnd[h]: the end h got, "none" = not run
  runs,       \* runs[h]: times h ran
  log,        \* hook ids in the order they ran
  everNeeds,  \* everNeeds[i]: every instance i held at some time (ghost)
  closing,    \* you called close()
  resolves, releases

vars == <<dep, node, cur, made, needs, failed, end, endBy, finished, hooks, nh, hookOk,
          hookEnd, runs, log, everNeeds, closing, resolves, releases>>

Init ==
  /\ dep = [r \in Res |-> IF r = "A" THEN "B" ELSE BReads]
  /\ node = [r \in Res |-> "unbuilt"]
  /\ cur = [r \in Res |-> 0]
  /\ made = 0
  /\ needs = [i \in Inst |-> {}]
  /\ failed = [i \in Inst |-> FALSE]
  /\ end = [i \in Inst |-> "none"]
  /\ endBy = [i \in Inst |-> "none"]
  /\ finished = [i \in Inst |-> FALSE]
  /\ hooks = [i \in Inst |-> <<>>]
  /\ nh = 0
  /\ hookOk = [h \in Hook |-> FALSE]
  /\ hookEnd = [h \in Hook |-> "none"]
  /\ runs = [h \in Hook |-> 0]
  /\ log = <<>>
  /\ everNeeds = [i \in Inst |-> {}]
  /\ closing = FALSE
  /\ resolves = 0 /\ releases = 0

Held(i) == \E j \in Inst : i \in needs[j]              \* isHeld 5790 (users > 0)
Unended(i) == i <= made /\ ~finished[i]
CanFinish(i) == Unended(i) /\ end[i] # "none" /\ ~Held(i)

(* A release runs the sync ends it can run inside the same call (drainReleased 5830), so
   no other call lands while one can run. *)
Quiet == ~\E i \in Inst : CanFinish(i)

(* needsHold 3703: the dependency's instance has hooks or holds, or it is not built. *)
NeedsHold(d) ==
  \/ node[d] = "unbuilt"
  \/ cur[d] # 0 /\ (Len(hooks[cur[d]]) > 0 \/ needs[cur[d]] # {})

(* One sync resolve of r, unbuilt. oR: r's factory returns a value ("ok") or throws.
   oD: the same for its dependency's factory, if that runs. Each factory that runs calls
   ctx.defer once, before it returns or throws. *)
YouResolve(r, oR, oD) ==
  LET d    == dep[r]
      iR   == IF cur[r] # 0 THEN cur[r] ELSE made + 1           \* instanceOf: reuse or make
      m1   == IF cur[r] # 0 THEN made ELSE made + 1
      hold == IF d = "none" THEN FALSE ELSE NeedsHold(d)
      m2   == IF d = "none" THEN m1 ELSE IF cur[d] = 0 THEN m1 + 1 ELSE m1
      iD   == IF d = "none" THEN 0 ELSE IF cur[d] # 0 THEN cur[d] ELSE IF m2 > m1 THEN m2 ELSE 0
      buildD == IF d = "none" THEN FALSE ELSE node[d] = "unbuilt"
      \* B's build reads A while A builds: holds A first (A holds B now), then CircularResource
      cycle  == IF buildD THEN dep[d] = r ELSE FALSE
      backHold == cycle   \* A's instance holds B, so needsHold(A) is true
      dRuns  == buildD /\ ~cycle                    \* d's factory runs
      dOk    == dRuns /\ oD = "ok"
      rRuns  == IF d = "none" THEN TRUE ELSE node[d] = "built" \/ dOk
      rOk    == rRuns /\ oR = "ok"
      dHook  == dRuns
      rHook  == rRuns
      hD1    == nh + 1
      hR1    == IF dHook THEN nh + 2 ELSE nh + 1
      Add(i, h, on) == IF on THEN Append(hooks[i], h) ELSE hooks[i]
  IN
  /\ ~closing /\ Quiet /\ resolves < MaxResolves
  /\ node[r] = "unbuilt"
  /\ dRuns \/ oD = "ok"              \* no choice when d's factory does not run
  /\ rRuns \/ oR = "ok"
  /\ resolves' = resolves + 1
  /\ made' = m2
  /\ cur' = [x \in Res |-> IF x = r THEN iR ELSE IF x = d THEN iD ELSE cur[x]]
  /\ needs' = [i \in Inst |->
                 IF i = iR /\ hold THEN needs[i] \cup {iD}
                 ELSE IF i = iD /\ backHold THEN needs[i] \cup {iR}
                 ELSE needs[i]]
  /\ everNeeds' = [i \in Inst |->
                 IF i = iR /\ hold THEN everNeeds[i] \cup {iD}
                 ELSE IF i = iD /\ backHold THEN everNeeds[i] \cup {iR}
                 ELSE everNeeds[i]]
  \* settleResourceInstance 3830: a failed build sets `failed`; a good build leaves it as it is
  /\ failed' = [i \in Inst |->
                 IF i = iR /\ ~rOk THEN TRUE
                 ELSE IF i = iD /\ buildD /\ ~dOk THEN TRUE
                 ELSE failed[i]]
  /\ node' = [x \in Res |->
                IF x = r THEN (IF rOk THEN "built" ELSE "unbuilt")
                ELSE IF x = d THEN (IF dOk THEN "built" ELSE node[x]) ELSE node[x]]
  /\ hooks' = [i \in Inst |->
                 IF iD # 0 /\ i = iD /\ i # iR THEN Add(i, hD1, dHook)
                 ELSE IF i = iR THEN Add(i, hR1, rHook)
                 ELSE hooks[i]]
  /\ nh' = nh + (IF dHook THEN 1 ELSE 0) + (IF rHook THEN 1 ELSE 0)
  /\ hookOk' = [h \in Hook |->
                  IF dHook /\ h = hD1 THEN dOk
                  ELSE IF rHook /\ h = hR1 THEN rOk
                  ELSE hookOk[h]]
  /\ UNCHANGED <<dep, end, endBy, finished, hookEnd, runs, log, closing, releases>>

(* invalidateResource 5570 on r and on each built dependent (collectAffected): unlink the
   instance with `released`; unlinkInstance 3718 keeps `failed` when it is set. *)
YouRelease(r) ==
  LET dependents == {x \in Res : dep[x] = r /\ node[x] = "built"}
      hit == {r} \cup dependents
      gone == {cur[x] : x \in {y \in hit : cur[y] # 0}}
  IN
  /\ ~closing /\ Quiet /\ releases < MaxReleases
  /\ node[r] = "built" \/ cur[r] # 0
  /\ releases' = releases + 1
  /\ end' = [i \in Inst |-> IF i \in gone /\ end[i] = "none"
                              THEN (IF failed[i] THEN "failed" ELSE "released") ELSE end[i]]
  /\ endBy' = [i \in Inst |-> IF i \in gone /\ end[i] = "none" THEN "release" ELSE endBy[i]]
  /\ cur' = [x \in Res |-> IF x \in hit THEN 0 ELSE cur[x]]
  /\ node' = [x \in Res |-> IF x \in hit THEN "unbuilt" ELSE node[x]]
  /\ UNCHANGED <<dep, made, needs, failed, finished, hooks, nh, hookOk, hookEnd, runs, log,
                 everNeeds, closing, resolves>>

(* startClose: closeInstancesSync 4689 unlinks every instance with the close's end. *)
YouClose ==
  /\ ~closing /\ Quiet
  /\ closing' = TRUE
  /\ end' = [i \in Inst |-> IF i <= made /\ end[i] = "none"
                              THEN (IF failed[i] THEN "failed" ELSE "close") ELSE end[i]]
  /\ endBy' = [i \in Inst |-> IF i <= made /\ end[i] = "none" THEN "close" ELSE endBy[i]]
  /\ UNCHANGED <<dep, node, cur, made, needs, failed, finished, hooks, nh, hookOk, hookEnd,
                 runs, log, everNeeds, resolves, releases>>

Rev(s) == [k \in 1..Len(s) |-> s[Len(s) - k + 1]]
InSeq(h, s) == \E k \in 1..Len(s) : s[k] = h

(* finishInstance 3777 / finishHook 3757: an unlinked instance nothing holds runs its hooks
   last first with its end, then completeInstance 3743 drops its holds. *)
EndsRun(i) ==
  /\ CanFinish(i)
  /\ finished' = [finished EXCEPT ![i] = TRUE]
  /\ needs' = [needs EXCEPT ![i] = {}]
  /\ hookEnd' = [h \in Hook |-> IF InSeq(h, hooks[i]) THEN end[i] ELSE hookEnd[h]]
  /\ runs' = [h \in Hook |-> IF InSeq(h, hooks[i]) THEN runs[h] + 1 ELSE runs[h]]
  /\ log' = log \o Rev(hooks[i])
  /\ UNCHANGED <<dep, node, cur, made, failed, end, endBy, hooks, nh, hookOk, everNeeds,
                 closing, resolves, releases>>

(* Nothing more runs after close: closed, or stuck. *)
Done ==
  /\ closing
  /\ ~\E i \in Inst : CanFinish(i)
  /\ UNCHANGED vars

Next ==
  \/ \E oR, oD \in {"ok", "throws"} : YouResolve("A", oR, oD)
  \/ \E r \in Res : YouRelease(r)
  \/ YouClose
  \/ \E i \in Inst : EndsRun(i)
  \/ Done

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* Rules. Each is ADR text. *)

\* ADR 0063 d3 + ADR 0026 Q4: a release fixes the outcome to `released`; "a release-selected
\* build ends `released`". A hook from a build that returned a value, run by a release,
\* gets `released`.
GoodBuildReleaseEndsReleased ==
  \A i \in Inst : \A k \in 1..Len(hooks[i]) :
    LET h == hooks[i][k] IN
    (hookOk[h] /\ endBy[i] = "release" /\ runs[h] > 0) => hookEnd[h] = "released"

\* ADR 0063 d6: close unlinks every instance with the close outcome. A hook from a build that
\* returned a value, run by the close, gets the close's end.
GoodBuildCloseEndsWithClose ==
  \A i \in Inst : \A k \in 1..Len(hooks[i]) :
    LET h == hooks[i][k] IN
    (hookOk[h] /\ endBy[i] = "close" /\ runs[h] > 0) => hookEnd[h] = "close"

\* ADR 0026 Q4: one end per lifetime. A hook runs at most once.
HookRunsOnce == \A h \in Hook : runs[h] <= 1

\* ADR 0026 Q1 + ADR 0063 d4: an instance's hooks run in reverse registration order.
HooksRunLastFirst ==
  \A i \in Inst : \A a, b \in 1..Len(hooks[i]) :
    LET ha == hooks[i][a]
        hb == hooks[i][b]
        pos(h) == CHOOSE k \in 1..Len(log) : log[k] = h
    IN (a < b /\ runs[ha] > 0 /\ runs[hb] > 0) => pos(hb) < pos(ha)

\* ADR 0063 d4: a dependency never finishes before a live dependent.
DependentFinishesFirst ==
  \A i, d \in Inst : (d \in everNeeds[i] /\ finished[d]) => (finished[i] \/ i > made)

\* ADR 0063 d3: the next resolve after a release builds a fresh instance: no hook joins an
\* instance whose end is fixed (sync builds; ADR 0063 d5 late async hooks are left out).
NoHookOnEndedInstance ==
  \A i \in Inst : endBy[i] = "release" => \A r \in Res : cur[r] # i

\* ADR 0027 (close always resolves) + ADR 0011 (close is total, runs every teardown):
\* after close, while an instance is not finished, one can still finish.
CloseResolves ==
  closing => ((\A i \in Inst : ~Unended(i)) \/ (\E i \in Inst : CanFinish(i)))

\* ADR 0011: close runs every teardown. Once close is over, every hook ran.
CloseRunsEveryHook ==
  (closing /\ \A i \in Inst : ~Unended(i)) => \A h \in 1..nh : runs[h] = 1

=============================================================================
