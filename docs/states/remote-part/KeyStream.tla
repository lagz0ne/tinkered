----------------------------- MODULE KeyStream -----------------------------
(* A reading root's plain (not keyed) key, as the code on origin/main
   c9c88174 has it: packages/core/src/remote-data.ts round 620,
   loop 663, mark 591. One key. The stream opens, pushes values, and ends
   clean or with a fault: link (the socket broke) or refused (the server's
   answer). Then the loop sleeps (50 ms, or back-off while the key has a
   fault) and opens again. The root may close. MaxOpens bounds the model. *)
EXTENDS Naturals

CONSTANTS MaxOpens

VARIABLES
  phase,     \* opening, reading, sleeping, stopped
  keyFault,  \* board.faults.key: none, link, refused
  opens      \* stream opens so far

vars == <<phase, keyFault, opens>>

Init == phase = "opening" /\ keyFault = "none" /\ opens = 1

StreamOpens == phase = "opening" /\ phase' = "reading" /\ UNCHANGED <<keyFault, opens>>

(* round 641-650: a pushed value; set 616 clears the key's fault. *)
ValueComes == phase = "reading" /\ keyFault' = "none" /\ UNCHANGED <<phase, opens>>

StreamEnds == phase = "reading" /\ phase' = "sleeping" /\ UNCHANGED <<keyFault, opens>>

(* round 655, loop 667: the stream fails; mark sets the key's fault. *)
StreamFails(kind) ==
  /\ phase \in {"opening", "reading"}
  /\ phase' = "sleeping" /\ keyFault' = kind
  /\ UNCHANGED opens

(* loop 671-672: the sleep ends; the loop opens the stream again. *)
SleepEnds ==
  /\ phase = "sleeping" /\ opens < MaxOpens
  /\ phase' = "opening" /\ opens' = opens + 1
  /\ UNCHANGED keyFault

RootCloses == phase # "stopped" /\ phase' = "stopped" /\ UNCHANGED <<keyFault, opens>>

Done == phase = "stopped" /\ UNCHANGED vars

Next ==
  \/ StreamOpens \/ ValueComes \/ StreamEnds
  \/ StreamFails("link") \/ StreamFails("refused")
  \/ SleepEnds \/ RootCloses \/ Done

Spec == Init /\ [][Next]_vars

(* ADR 0140 (The direction): "Core never asks again by itself after a
   fault. A broken link is the backend's to heal; any other fault is an
   answer (ADR 0139, decision 4)." So after a refused fault the stream
   does not open again by itself. *)
RefusedEndsAsking ==
  [][(phase = "sleeping" /\ keyFault = "refused") => phase' # "opening"]_vars
=============================================================================
