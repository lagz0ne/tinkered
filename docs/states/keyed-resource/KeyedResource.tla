---------------------------- MODULE KeyedResource ----------------------------
(***************************************************************************)
(* ONE keyed resource (a resource with config, ADR 0157) on one scope.     *)
(* It models the code on origin/main 3ff6778 (keyed path unchanged since   *)
(* 330b371): packages/core/src/index.ts, builtReader and class BuiltEntry. *)
(*                                                                         *)
(* A reader is a React useData (or a depends reader):                      *)
(*   render    = scope.resolve(read) then reader.get()                     *)
(*   subscribe = reader.watch(fn)   (useSyncExternalStore, commit)         *)
(*   leave     = the stop that watch returned                              *)
(* A reader that left still holds its entry object (React keeps the store  *)
(* on the controller), so it can subscribe again (StrictMode remount).     *)
(*                                                                         *)
(* An entry is one BuiltEntry object. The scope's map (builtKept) points   *)
(* from a key to at most one entry. The code is sync; a build's steps      *)
(* (ends run, factory runs, it returns or throws) are split here only to   *)
(* name them; no other step runs while one is busy.                        *)
(* The factory defers 2 ends then returns, or throws before any defer.     *)
(***************************************************************************)
EXTENDS Integers, FiniteSets

CONSTANTS Readers, Keys, Entries, MaxSrc, None,
  LateWatchRefused  \* FALSE: main d3734e2e, where a watch after the close
                    \* joins an entry another reader watches. TRUE: the fix
                    \* (card core/keyed-resource-watch-closed).

VARIABLES
  src,       \* the source cell's value (a version number)
  closed,    \* the scope closed
  map,       \* [Keys -> Entries \cup {None}]   builtKept for the layer
  ekey,      \* [Entries -> Keys \cup {None}]   None = no such object
  watchers,  \* [Entries -> SUBSET Readers]
  inputs,    \* [Entries -> -1..MaxSrc]         -1 = undefined
  ends,      \* [Entries -> 0..2]               ends of the last build, not run
  hooked,    \* [Entries -> BOOLEAN]            the scope close knows the entry
  rs,        \* [Readers -> {"idle","rendered","live","left"}]
  rat,       \* [Readers -> Entries \cup {None}] the entry the reader holds
  bld,       \* the build in flight, or None
  drain,     \* entries whose ends run now
  wake,      \* entries a source change still has to wake (one round)
  \* ghosts: what the rules need to see
  wroteInRead, \* a cell write landed while a reader's build ran
  endsOrderOk  \* each end that ran was the newest one still pending

vars == <<src, closed, map, ekey, watchers, inputs, ends, hooked, rs, rat,
          bld, drain, wake, wroteInRead, endsOrderOk>>

Busy == bld # None \/ drain # {} \/ wake # {}

\* What a build reads from the source. A close (with no withData, ADR 0069)
\* frees the store; a held reader then reads the cell's initial value.
Read == IF closed THEN 0 ELSE src

\* An entry a reader uses now: it watches it, or rendered from it.
Live(e) == watchers[e] # {} \/ \E r \in Readers : rs[r] = "rendered" /\ rat[r] = e

\* The readers of key k: rendered from or subscribed to an entry of k.
ReadersOf(k) == {r \in Readers : rs[r] \in {"rendered", "live"}
                                  /\ rat[r] # None /\ ekey[rat[r]] = k}

\* Start a build of entry e (BuiltEntry.fresh): inputs are set, then the
\* last build's ends run, then the factory runs.
\*   by:   "reader" (get / first watch: computing is set) or "source" (wake)
\*   sub:  the reader whose watch() waits for this build, or None
\*   noChange: ghost, a live entry of the same key already holds this source
StartBuild(e, by, sub) ==
  /\ bld' = [e |-> e, by |-> by, sub |-> sub, wrote |-> FALSE,
             noChange |-> \E f \in Entries : ekey[f] = ekey[e] /\ Live(f)
                                             /\ inputs[f] = Read]
  /\ inputs' = [inputs EXCEPT ![e] = Read]
  /\ drain' = IF ends[e] > 0 THEN {e} ELSE {}

Init ==
  /\ src = 0
  /\ closed = FALSE
  /\ map = [k \in Keys |-> None]
  /\ ekey = [e \in Entries |-> None]
  /\ watchers = [e \in Entries |-> {}]
  /\ inputs = [e \in Entries |-> -1]
  /\ ends = [e \in Entries |-> 0]
  /\ hooked = [e \in Entries |-> FALSE]
  /\ rs = [r \in Readers |-> "idle"]
  /\ rat = [r \in Readers |-> None]
  /\ bld = None
  /\ drain = {}
  /\ wake = {}
  /\ wroteInRead = FALSE
  /\ endsOrderOk = TRUE

(* A reader renders key k: useData resolves the read (builtReader: the  *)
(* map's entry, or a new one), then get() builds when the source moved. *)
(* A closed scope refuses the resolve (Disposed), so no render then.    *)
(* A reader that left drops its old entry object; with no holder and no *)
(* end left, it is gone (garbage).                                       *)
ReaderRenders(r, k) ==
  /\ ~Busy /\ ~closed
  /\ rs[r] \in {"idle", "left"}
  /\ LET old  == rat[r]
         gone == old # None /\ \A q \in Readers \ {r} : rat[q] # old
                 /\ \A kk \in Keys : map[kk] # old
                 /\ watchers[old] = {} /\ ends[old] = 0
         free == {e \in Entries : ekey[e] = None \/ (gone /\ e = old)}
         new  == CHOOSE e \in free : TRUE
         e    == IF map[k] # None THEN map[k] ELSE new
     IN /\ map[k] # None \/ free # {}
        /\ ekey' = [f \in Entries |-> IF f = e THEN k
                                     ELSE IF gone /\ f = old THEN None
                                     ELSE ekey[f]]
        /\ map' = [map EXCEPT ![k] = e]
        /\ rat' = [rat EXCEPT ![r] = e]
        /\ rs' = [rs EXCEPT ![r] = "rendered"]
        /\ LET fresh == map[k] = None   \* a new object: all fields new
               inp == IF fresh THEN -1 ELSE inputs[e]
           IN /\ watchers' = IF fresh THEN [watchers EXCEPT ![e] = {}] ELSE watchers
              /\ hooked' = IF fresh \/ (gone /\ old # e)
                           THEN [f \in Entries |-> IF f = e /\ fresh THEN FALSE
                                                   ELSE IF gone /\ f = old THEN FALSE
                                                   ELSE hooked[f]]
                           ELSE hooked
              /\ IF inp # src
                 THEN /\ bld' = [e |-> e, by |-> "reader", sub |-> None, wrote |-> FALSE,
                                 noChange |-> \E f \in Entries :
                                     f # e /\ ekey[f] = k /\ Live(f) /\ inputs[f] = src]
                      /\ inputs' = [f \in Entries |-> IF f = e THEN src
                                       ELSE IF gone /\ f = old THEN -1 ELSE inputs[f]]
                      /\ drain' = IF ~fresh /\ ends[e] > 0 THEN {e} ELSE {}
                 ELSE /\ UNCHANGED <<bld, drain>>
                      /\ inputs' = [f \in Entries |-> IF gone /\ f = old THEN -1
                                                      ELSE inputs[f]]
        /\ UNCHANGED <<ends>>
  /\ UNCHANGED <<src, closed, wake, wroteInRead, endsOrderOk>>

(* A reader subscribes to the entry it holds (watch). The first watcher  *)
(* builds when the source moved. A reader that left and subscribes again *)
(* (React StrictMode remount) uses the same object, even when the map    *)
(* dropped it. On a closed scope the build runs, then the source's watch *)
(* throws Disposed and the reader is not added. When another reader      *)
(* still watches the entry, main d3734e2e adds the reader anyway; with   *)
(* LateWatchRefused the watch raises Disposed and adds no one.           *)
ReaderSubscribes(r) ==
  /\ ~Busy
  /\ rs[r] \in {"rendered", "left"}
  /\ LET e == rat[r] IN
     IF watchers[e] = {} /\ inputs[e] # Read
     THEN /\ StartBuild(e, "reader", r)
          /\ UNCHANGED <<watchers, rs>>
     ELSE /\ ~closed \/ (~LateWatchRefused /\ watchers[e] # {})
          /\ watchers' = [watchers EXCEPT ![e] = @ \cup {r}]
          /\ rs' = [rs EXCEPT ![r] = "live"]
          /\ UNCHANGED <<bld, inputs, drain>>
  /\ UNCHANGED <<src, closed, map, ekey, ends, hooked, rat, wake,
                 wroteInRead, endsOrderOk>>

(* A reader leaves (the stop from watch). The last watcher: the map drops *)
(* the entry, the source watch stops; with ends, they run and inputs go.  *)
ReaderLeaves(r) ==
  /\ ~Busy
  /\ rs[r] = "live"
  /\ LET e == rat[r]
         w == watchers[e] \ {r}
     IN /\ watchers' = [watchers EXCEPT ![e] = w]
        /\ rs' = [rs EXCEPT ![r] = "left"]
        /\ IF w = {}
           THEN /\ map' = IF map[ekey[e]] = e THEN [map EXCEPT ![ekey[e]] = None] ELSE map
                /\ drain' = IF ends[e] > 0 THEN {e} ELSE {}
                /\ inputs' = IF ends[e] > 0 THEN [inputs EXCEPT ![e] = -1] ELSE inputs
           ELSE UNCHANGED <<map, drain, inputs>>
  /\ UNCHANGED <<src, closed, ekey, ends, hooked, rat, bld, wake,
                 wroteInRead, endsOrderOk>>

(* The source cell changes. One round wakes each entry that watches it. *)
(* A closed scope refuses the write (Disposed).                          *)
SourceChanges ==
  /\ ~Busy /\ ~closed
  /\ src < MaxSrc
  /\ src' = src + 1
  /\ wake' = {e \in Entries : watchers[e] # {}}
  /\ UNCHANGED <<closed, map, ekey, watchers, inputs, ends, hooked, rs, rat,
                 bld, drain, wroteInRead, endsOrderOk>>

(* The round wakes one entry: it builds when its inputs moved. *)
EntryWakes(e) ==
  /\ bld = None /\ drain = {}
  /\ e \in wake
  /\ wake' = wake \ {e}
  /\ IF inputs[e] # Read
     THEN StartBuild(e, "source", None)
     ELSE UNCHANGED <<bld, inputs, drain>>
  /\ UNCHANGED <<src, closed, map, ekey, watchers, ends, hooked, rs, rat,
                 wroteInRead, endsOrderOk>>

(* One end runs: end() splices the ends and runs them reversed. *)
EndRuns(e) ==
  /\ e \in drain
  /\ \A f \in drain : ends[f] = 1 => f = e   \* finish one entry first
  \* end() runs this.ends.splice(0).reverse(): the end that runs is number
  \* ends[e], the newest one still pending. The model copies that order.
  /\ LET runs == ends[e]  newest == ends[e]
     IN endsOrderOk' = (endsOrderOk /\ runs = newest)
  /\ ends' = [ends EXCEPT ![e] = @ - 1]
  /\ drain' = IF ends[e] = 1 THEN drain \ {e} ELSE drain
  /\ UNCHANGED <<src, closed, map, ekey, watchers, inputs, hooked, rs, rat,
                 bld, wake, wroteInRead>>

\* After the factory: the waiting watch() adds its reader (it throws
\* Disposed on a closed scope, so the reader is not added).
AfterBuild ==
  IF bld.sub # None /\ ~closed
  THEN /\ watchers' = [watchers EXCEPT ![bld.e] = @ \cup {bld.sub}]
       /\ rs' = [rs EXCEPT ![bld.sub] = "live"]
  ELSE UNCHANGED <<watchers, rs>>

(* The factory writes a cell (not its source). When a reader started the *)
(* build, `computing` is set and the write raises WriteInRead: the       *)
(* factory throws. Else the write lands.                                 *)
BuildWritesCell ==
  /\ bld # None /\ drain = {}
  /\ ~bld.wrote
  /\ LET computing == bld.by = "reader" IN    \* fresh(woken): !woken sets it
     IF computing
     THEN /\ bld' = None                     \* WriteInRead: the build throws
          /\ AfterBuild
          /\ UNCHANGED wroteInRead
     ELSE /\ bld' = [bld EXCEPT !.wrote = TRUE]
          /\ wroteInRead' = (wroteInRead \/ bld.by = "reader")
          /\ UNCHANGED <<watchers, rs>>
  /\ UNCHANGED <<src, closed, map, ekey, inputs, ends, hooked, rat, drain, wake,
                 endsOrderOk>>

(* The factory defers two ends and returns: the build finishes. A defer *)
(* hooks the entry into the scope close once (hooked).                  *)
BuildFinishes ==
  /\ bld # None /\ drain = {}
  /\ ends' = [ends EXCEPT ![bld.e] = 2]
  /\ hooked' = [hooked EXCEPT ![bld.e] = TRUE]
  /\ AfterBuild
  /\ bld' = None
  /\ UNCHANGED <<src, closed, map, ekey, inputs, rat, drain, wake,
                 wroteInRead, endsOrderOk>>

(* The factory throws before its first defer: the entry holds a fault. *)
BuildThrows ==
  /\ bld # None /\ drain = {} /\ ~bld.wrote
  /\ AfterBuild
  /\ bld' = None
  /\ UNCHANGED <<src, closed, map, ekey, inputs, ends, hooked, rat, drain, wake,
                 wroteInRead, endsOrderOk>>

(* The scope closes: each hooked entry's end() runs (the layer drains its *)
(* defers last first). Inputs and watchers stay as they are.             *)
ScopeCloses ==
  /\ ~Busy /\ ~closed
  /\ closed' = TRUE
  /\ drain' = {e \in Entries : hooked[e] /\ ends[e] > 0}
  /\ UNCHANGED <<src, map, ekey, watchers, inputs, ends, hooked, rs, rat,
                 bld, wake, wroteInRead, endsOrderOk>>

\* After the scope closed, a state may have no step out: an end state.
Done ==
  /\ closed /\ ~Busy
  /\ UNCHANGED vars

Next ==
  \/ \E r \in Readers, k \in Keys : ReaderRenders(r, k)
  \/ \E r \in Readers : ReaderSubscribes(r)
  \/ \E r \in Readers : ReaderLeaves(r)
  \/ SourceChanges
  \/ \E e \in Entries : EntryWakes(e)
  \/ \E e \in Entries : EndRuns(e)
  \/ BuildFinishes
  \/ BuildThrows
  \/ BuildWritesCell
  \/ ScopeCloses
  \/ Done

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* RULES. Each one is text from an ADR. *)

\* ADR 0157, decision 5: "An end runs before the next build".
\* Per key: when the factory of key k runs, no end of an earlier build of
\* key k still waits.
EndBeforeNextBuild ==
  (bld # None /\ drain = {}) =>
    \A f \in Entries : (f # bld.e /\ ekey[f] = ekey[bld.e]) => ends[f] = 0

\* ADR 0157, decision 5: an end runs "when the last reader leaves".
\* A key with no reader has no end that still waits.
EndWhenLastReaderLeaves ==
  ~Busy => \A k \in Keys :
    ReadersOf(k) = {} =>
      \A f \in Entries : ekey[f] = k => ends[f] = 0

\* ADR 0157, decision 5: an end runs "when the scope closes".
\* After the scope closed, no end still waits.
EndsRunWhenScopeCloses ==
  (closed /\ ~Busy) => \A f \in Entries : ends[f] = 0

\* ADR 0157, decision 5: "Ends run last first, as a resource's do."
EndsRunLastFirst == endsOrderOk

\* ADR 0157, decision 4: "Each build is a span ... A read with no change
\* makes none." A build does not start while a live entry of the same key
\* already holds the source's current value.
NoChangeNoBuild == bld # None => ~bld.noChange

\* ADR 0157, decision 7 (ADR 0152, decision 7): "A build that a reader
\* starts must not write a cell: WriteInRead."
NoWriteInRead == ~wroteInRead

\* ADR 0150, decision 5 (0157 changes 0150 only in name and the write
\* rule): "One entry per key text. Every reader of the same key shares it."
OneEntryPerKey ==
  \A k \in Keys : Cardinality({f \in Entries : ekey[f] = k /\ Live(f)}) <= 1

\* ADR 0150, decision 5: "The last reader leaves, the entry goes."
\* A key with no reader has no entry in the scope's map.
NoReaderNoEntry ==
  ~Busy => \A k \in Keys : ReadersOf(k) = {} => map[k] = None

TypeOK ==
  /\ src \in 0..MaxSrc
  /\ ends \in [Entries -> 0..2]
  /\ inputs \in [Entries -> -1..MaxSrc]

(* ADR 0157 As built (core/keyed-watch-after-close, ff565316; the Core     *)
(* README): a held reader's watch after the scope closed raises Disposed.  *)
(* So after the close no entry gains a watcher, also when another reader   *)
(* still watches it.                                                       *)
WatchAfterCloseRefused ==
  [][closed => \A f \in Entries : watchers'[f] \subseteq watchers[f]]_vars

=============================================================================
