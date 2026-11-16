------------------------------ MODULE Round ------------------------------
(* The round of ADR 0152: how a cell write tells its watchers.
   Code: packages/core/src/index.ts on origin/main c9c88174
   (same lines as 3ff67780): writeCell 1924, flushCell 1880,
   flushOne 1897, notifyLayer 1906, flushNsWatchers 1958,
   tellWrite 8842, watcherThrew 8856, tell 8877, drainRounds 8893.
   The round lives in 3 module globals: inRound, roundDepth, waiting.
   One scope, two cells A and B. Watchers a1, a2 hear A (a1 first);
   b1 hears B. a1 may write B and b1 may write A, so a chain can
   grow deep. LIMIT stands for the code's 100. Each cell value flips
   on a write, so every write differs (an equal write is dropped
   before any round, writeCell 1929). *)
EXTENDS Naturals, Sequences, FiniteSets

CONSTANTS LIMIT, MaxCalls

Cells == {"A", "B"}
W == {"a1", "a2", "b1"}
CellOf == [w \in W |-> IF w = "b1" THEN "B" ELSE "A"]
WatchersOf(c) == IF c = "A" THEN <<"a1", "a2">> ELSE <<"b1">>
Writes == [w \in W |-> CASE w = "a1" -> "B" [] w = "b1" -> "A" [] OTHER -> "none"]
NoRound == [c |-> "none", d |-> 0, cold |-> FALSE, left |-> <<>>, v |-> 0]

VARIABLES
  val,          \* the value of each cell (0 or 1)
  prev,         \* code: rec.prev, the value the layer last told
  heard,        \* the value each watcher heard last
  inRound,      \* code: inRound
  depth,        \* code: roundDepth
  waiting,      \* code: waiting, the rounds that wait (FIFO)
  cur,          \* the round that runs now
  phase,        \* rest (no call on the stack), compare, tell, next
  failed,       \* code: drainRounds' held error: none, watcher, eq
  calls,        \* calls the app made (bound)
  \* ghost variables, for the rules only
  excused,      \* watchers the ADR lets miss a write (their round ended)
  firstThrown,  \* the first error thrown in this call
  hitDepth,     \* this call hit the round limit
  outcome,      \* what the app's last call got
  readerWrote   \* a build a reader started changed a cell

vars == <<val, prev, heard, inRound, depth, waiting, cur, phase, failed, calls,
          excused, firstThrown, hitDepth, outcome, readerWrote>>

Init ==
  /\ val = [c \in Cells |-> 0]
  /\ prev = [c \in Cells |-> 0]
  /\ heard = [w \in W |-> 0]
  /\ inRound = FALSE /\ depth = 0 /\ waiting = <<>>
  /\ cur = NoRound /\ phase = "rest" /\ failed = "none" /\ calls = 0
  /\ excused = {} /\ firstThrown = "none" /\ hitDepth = FALSE
  /\ outcome = "none" /\ readerWrote = FALSE

First(old, new) == IF old = "none" THEN new ELSE old
ToSet(s) == {s[i] : i \in 1..Len(s)}
WatchersIn(rs) == {w \in W : \E i \in 1..Len(rs) : CellOf[w] = rs[i].c}

(* A round starts now: tellWrite 8845 (hot) or tell 8880 (cold). *)
Start(c, v, cold) ==
  /\ inRound' = TRUE /\ depth' = 0
  /\ cur' = [c |-> c, d |-> 0, cold |-> cold, left |-> <<>>, v |-> v]
  /\ phase' = "compare" /\ failed' = "none"
  /\ firstThrown' = "none" /\ hitDepth' = FALSE /\ outcome' = "pending"
  /\ UNCHANGED waiting

(* The app writes a cell (set). In a round the write keeps its value and its
   round waits (tellWrite 8843, waitRound 8836). *)
YouWrite(c) ==
  /\ phase = "rest" /\ calls < MaxCalls
  /\ calls' = calls + 1
  /\ val' = [val EXCEPT ![c] = 1 - val[c]]
  /\ IF inRound
       THEN /\ waiting' = Append(waiting, [c |-> c, d |-> depth + 1])
            /\ outcome' = "ok" /\ firstThrown' = "none" /\ hitDepth' = FALSE
            /\ UNCHANGED <<inRound, depth, cur, phase, failed>>
       ELSE Start(c, 1 - val[c], FALSE)
  /\ UNCHANGED <<prev, heard, excused, readerWrote>>

(* The app releases a cell it wrote: the value goes back to 0, and a cold
   round tells the watchers (releaseNode 5700, tell 8877). ADR 0152 d4. *)
YouRelease(c) ==
  /\ phase = "rest" /\ calls < MaxCalls /\ val[c] = 1
  /\ calls' = calls + 1
  /\ val' = [val EXCEPT ![c] = 0]
  /\ IF inRound
       THEN /\ waiting' = Append(waiting, [c |-> c, d |-> depth + 1])
            /\ outcome' = "ok" /\ firstThrown' = "none" /\ hitDepth' = FALSE
            /\ UNCHANGED <<inRound, depth, cur, phase, failed>>
       ELSE Start(c, 0, TRUE)
  /\ UNCHANGED <<prev, heard, excused, readerWrote>>

(* A build a reader starts (a keyed resource's factory) writes a cell that
   differs: writeCell 1931 raises WriteInRead, the value stays. *)
ReaderBuildWrites(c) ==
  /\ phase = "rest" /\ calls < MaxCalls
  /\ calls' = calls + 1
  /\ outcome' = "WriteInRead" /\ firstThrown' = "none" /\ hitDepth' = FALSE
  /\ UNCHANGED <<val, prev, heard, inRound, depth, waiting, cur, phase, failed,
                 excused, readerWrote>>

(* flushOne 1902: the cell's eq compares the last told value to the new one. *)
EqSame ==
  /\ phase = "compare" /\ prev[cur.c] = val[cur.c]
  /\ phase' = "next" /\ cur' = NoRound
  /\ UNCHANGED <<val, prev, heard, inRound, depth, waiting, failed, calls,
                 excused, firstThrown, hitDepth, outcome, readerWrote>>

EqDiffers ==
  /\ phase = "compare" /\ prev[cur.c] # val[cur.c]
  /\ prev' = [prev EXCEPT ![cur.c] = val[cur.c]]
  /\ cur' = [cur EXCEPT !.left = WatchersOf(cur.c), !.v = val[cur.c]]
  /\ phase' = "tell"
  /\ UNCHANGED <<val, heard, inRound, depth, waiting, failed, calls,
                 excused, firstThrown, hitDepth, outcome, readerWrote>>

(* The user's eq throws. In the first round of a hot write (depth 0) no catch
   is around it (flushOne 1902, pendingNsWatchers 1991): the error leaves
   tellWrite and inRound stays true. In a waiting round, or on the cold path,
   drainRounds 8903 or tell 8883 catches it. *)
EqThrows ==
  /\ phase = "compare"
  /\ firstThrown' = First(firstThrown, "eq")
  /\ excused' = excused \cup ToSet(WatchersOf(cur.c))
  /\ cur' = NoRound
  /\ IF cur.d = 0 /\ ~cur.cold
       THEN /\ phase' = "rest" /\ outcome' = "eq"
            /\ UNCHANGED failed
       ELSE /\ phase' = "next" /\ failed' = First(failed, "eq")
            /\ UNCHANGED outcome
  /\ UNCHANGED <<val, prev, heard, inRound, depth, waiting, calls, hitDepth, readerWrote>>

Hear(w) ==
  /\ heard' = [heard EXCEPT ![w] = cur.v]
  /\ excused' = excused \ {w}

(* notifyLayer 1909: the next watcher hears the value. *)
WatcherHears ==
  /\ phase = "tell" /\ cur.left # <<>>
  /\ Hear(Head(cur.left))
  /\ cur' = [cur EXCEPT !.left = Tail(cur.left)]
  /\ UNCHANGED <<val, prev, inRound, depth, waiting, phase, failed, calls,
                 firstThrown, hitDepth, outcome, readerWrote>>

(* The watcher writes the other cell: the value lands now, its round waits one
   deeper (ADR 0152 d2, d3, d5). *)
WatcherWrites ==
  /\ phase = "tell" /\ cur.left # <<>>
  /\ LET w == Head(cur.left) IN
       /\ Writes[w] # "none"
       /\ Hear(w)
       /\ val' = [val EXCEPT ![Writes[w]] = 1 - val[Writes[w]]]
       /\ waiting' = Append(waiting, [c |-> Writes[w], d |-> cur.d + 1])
  /\ cur' = [cur EXCEPT !.left = Tail(cur.left)]
  /\ UNCHANGED <<prev, inRound, depth, phase, failed, calls,
                 firstThrown, hitDepth, outcome, readerWrote>>

(* The watcher throws: the later watchers of this round are skipped
   (notifyLayer 1911, watcherThrew 8856, drainRounds 8903). *)
WatcherThrows ==
  /\ phase = "tell" /\ cur.left # <<>>
  /\ heard' = [heard EXCEPT ![Head(cur.left)] = cur.v]
  /\ excused' = (excused \ {Head(cur.left)}) \cup ToSet(Tail(cur.left))
  /\ failed' = First(failed, "watcher")
  /\ firstThrown' = First(firstThrown, "watcher")
  /\ cur' = NoRound /\ phase' = "next"
  /\ UNCHANGED <<val, prev, inRound, depth, waiting, calls, hitDepth, outcome, readerWrote>>

RoundTold ==
  /\ phase = "tell" /\ cur.left = <<>>
  /\ cur' = NoRound /\ phase' = "next"
  /\ UNCHANGED <<val, prev, heard, inRound, depth, waiting, failed, calls,
                 excused, firstThrown, hitDepth, outcome, readerWrote>>

(* drainRounds 8896-8905: the next round that waited runs. *)
NextRound ==
  /\ phase = "next" /\ waiting # <<>> /\ Head(waiting).d <= LIMIT
  /\ cur' = [c |-> Head(waiting).c, d |-> Head(waiting).d, cold |-> FALSE,
             left |-> <<>>, v |-> 0]
  /\ depth' = Head(waiting).d
  /\ waiting' = Tail(waiting)
  /\ phase' = "compare"
  /\ UNCHANGED <<val, prev, heard, inRound, failed, calls,
                 excused, firstThrown, hitDepth, outcome, readerWrote>>

(* tooDeep 8916: past the limit, UpdateDepth; the finally clears the queue. *)
TooDeep ==
  /\ phase = "next" /\ waiting # <<>> /\ Head(waiting).d > LIMIT
  /\ excused' = excused \cup WatchersIn(waiting)
  /\ waiting' = <<>> /\ inRound' = FALSE /\ depth' = 0
  /\ phase' = "rest" /\ outcome' = "UpdateDepth" /\ hitDepth' = TRUE
  /\ UNCHANGED <<val, prev, heard, cur, failed, calls, firstThrown, readerWrote>>

(* The queue is empty: the round flag clears; the held error goes to the write. *)
RoundsEnd ==
  /\ phase = "next" /\ waiting = <<>>
  /\ inRound' = FALSE /\ depth' = 0 /\ phase' = "rest"
  /\ outcome' = IF failed = "none" THEN "ok" ELSE failed
  /\ UNCHANGED <<val, prev, heard, waiting, cur, failed, calls,
                 excused, firstThrown, hitDepth, readerWrote>>

Done ==
  /\ phase = "rest" /\ calls = MaxCalls
  /\ UNCHANGED vars

Next ==
  \/ \E c \in Cells : YouWrite(c)
  \/ \E c \in Cells : YouRelease(c)
  \/ \E c \in Cells : ReaderBuildWrites(c)
  \/ EqSame \/ EqDiffers \/ EqThrows
  \/ WatcherHears \/ WatcherWrites \/ WatcherThrows \/ RoundTold
  \/ NextRound \/ TooDeep \/ RoundsEnd
  \/ Done

Spec == Init /\ [][Next]_vars

-----------------------------------------------------------------------------
(* RULES. Each comes from ADR text. *)

(* ADR 0152 d3 (and d1): a write made in a round waits, then runs after the
   rounds made before it. So once no call is on the stack, no round waits
   and no round is open. ("A round always ends.") *)
RoundEndsAtRest == phase = "rest" => (~inRound /\ waiting = <<>>)

(* ADR 0152 d1 and d3: a round tells the watchers of one write; each watcher
   hears the writes in order, so at rest it has heard the latest value.
   Excused, as the ADR allows: the later watchers of a round a watcher threw
   in (d8, "What it does not do"), the watchers of the rounds UpdateDepth
   cut (d6), and the watchers of a round whose own eq threw. *)
EveryWatcherTold ==
  phase = "rest" => \A w \in W : heard[w] = val[CellOf[w]] \/ w \in excused

(* ADR 0152 d5 + d6: no round deeper than the limit runs. *)
NoRoundPastLimit == cur.d <= LIMIT

(* ADR 0152 d6: past the limit, the first write raises UpdateDepth. *)
DepthRaises == (phase = "rest" /\ hitDepth) => outcome = "UpdateDepth"

(* ADR 0152 d8: a watcher that throws ends its own round only; the first
   error goes to the first write. Checked where d6 does not also apply: the
   ADR does not say which of the two wins (see the report). *)
FirstErrorToFirstWrite ==
  (phase = "rest" /\ firstThrown = "watcher" /\ ~hitDepth) => outcome = "watcher"

(* ADR 0157 d7 (was ADR 0152 d7): a build a reader starts must not write a
   cell: WriteInRead. *)
NoWriteInRead == ~readerWrote

=============================================================================
