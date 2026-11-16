---------------------------- MODULE RemotePart ----------------------------
(* A client's keyed parts (ADR 0136-0139), as the code on origin/main
   c9c88174 has them: packages/core/src/remote-data.ts
   readKeyed 755, stand 770, ask 789, settle 797, apply 828,
   reask 844, parked 858, follow 866, own 915, listen 924, mark 591.
   One keyed board, key "tasks". Two parts on that key, A and B, that
   share no member (no part rides another). Readers: at most Readers in
   all, counted per part. No refetchInterval. One link; it drops at most
   MaxDrops times. At most MaxAsks asks in all. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Parts, Readers, MaxAsks, MaxDrops

P == Parts

VARIABLES
  refs,       \* readers of each part (all readers: at most Readers)
  stream,     \* each part's stream: off, opening, open, backoff, parked
  status,     \* each part's state: none, pending, ready, refused, link
  members,    \* each part has members in the cell
  asks,       \* asks in flight: [id, p, newer] (newer: a later ask started)
  nextId,     \* the id the next ask gets (bound: MaxAsks)
  link,       \* up or down
  drops,      \* link drops so far (bound: MaxDrops)
  keyFault,   \* board.faults.tasks: none, refused, link (one per key)
  \* ghost variables, for the rules only
  lastStarted,  \* each part's newest ask id, 0 for none
  stale,        \* an answer was put in after a later ask of its part started
  appliedId,    \* the ask whose answer or fault set the state; 0 = a stream did
  invAt,        \* an awaited invalidate of the part: the first id it may wait on
  invReturned   \* an invalidate returned before an ask it started set the state

vars == <<refs, stream, status, members, asks, nextId, link, drops, keyFault,
          lastStarted, stale, appliedId, invAt, invReturned>>

InUse(p) == refs[p] > 0
Reading == LET S[Q \in SUBSET P] == IF Q = {} THEN 0
                ELSE LET p == CHOOSE x \in Q : TRUE IN refs[p] + S[Q \ {p}]
           IN S[P]

Init ==
  /\ refs = [p \in P |-> 0]
  /\ stream = [p \in P |-> "off"]
  /\ status = [p \in P |-> "none"]
  /\ members = [p \in P |-> FALSE]
  /\ asks = {} /\ nextId = 1
  /\ link = "up" /\ drops = 0 /\ keyFault = "none"
  /\ lastStarted = [p \in P |-> 0] /\ stale = FALSE
  /\ appliedId = [p \in P |-> 0]
  /\ invAt = [p \in P |-> 0] /\ invReturned = FALSE

(* ask 789: a new ask; each ask in flight of the part now has a later one. *)
StartAsk(p) ==
  /\ nextId <= MaxAsks
  /\ asks' = {IF a.p = p THEN [a EXCEPT !.newer = TRUE] ELSE a : a \in asks}
             \cup {[id |-> nextId, p |-> p, newer |-> FALSE]}
  /\ nextId' = nextId + 1
  /\ lastStarted' = [lastStarted EXCEPT ![p] = nextId]

(* A fault from a stream: mark 591 sets the key fault, stand 770 the part. *)
StreamFault(p, kind, next) ==
  /\ stream' = [stream EXCEPT ![p] = next]
  /\ status' = [status EXCEPT ![p] = kind]
  /\ keyFault' = kind
  /\ appliedId' = [appliedId EXCEPT ![p] = 0]

(* listen 924: the first reader joins the part: state pending, own stream. *)
ReaderReads(p) ==
  /\ Reading < Readers
  /\ refs' = [refs EXCEPT ![p] = refs[p] + 1]
  /\ IF ~InUse(p)
       THEN /\ stream' = [stream EXCEPT ![p] = "opening"]
            /\ status' = [status EXCEPT ![p] = "pending"]
            /\ appliedId' = [appliedId EXCEPT ![p] = 0]
       ELSE UNCHANGED <<stream, status, appliedId>>
  /\ UNCHANGED <<members, asks, nextId, link, drops, keyFault,
                 lastStarted, stale, invAt, invReturned>>

(* listen 935: the last reader leaves: the stream stops, the state and the
   members go. The asks in flight stay; their answers find no part in use. *)
ReaderLeaves(p) ==
  /\ InUse(p)
  /\ refs' = [refs EXCEPT ![p] = refs[p] - 1]
  /\ IF refs[p] = 1
            THEN /\ stream' = [stream EXCEPT ![p] = "off"]
                 /\ status' = [status EXCEPT ![p] = "none"]
                 /\ members' = [members EXCEPT ![p] = FALSE]
       ELSE UNCHANGED <<stream, status, members>>
  /\ UNCHANGED <<asks, nextId, link, drops, keyFault, lastStarted, stale,
                 appliedId, invAt, invReturned>>

(* follow 869: the watch call is taken. *)
StreamOpens(p) ==
  /\ stream[p] = "opening" /\ link = "up"
  /\ stream' = [stream EXCEPT ![p] = "open"]
  /\ UNCHANGED <<refs, status, members, asks, nextId, link, drops, keyFault,
                 lastStarted, stale, appliedId, invAt, invReturned>>

(* follow 882-891: the server refuses the stream (at the open, or as a push):
   a fault that is an answer; the part parks (ADR 0139 4). *)
StreamRefused(p) ==
  /\ stream[p] \in {"opening", "open"} /\ link = "up"
  /\ StreamFault(p, "refused", "parked")
  /\ UNCHANGED <<refs, members, asks, nextId, link, drops, lastStarted, stale,
                 invAt, invReturned>>

(* follow 878: a server signal names the part; the client asks. The open
   watch says "all dirty" first, so this is also the first ask. *)
ServerSignals(p) ==
  /\ stream[p] = "open" /\ link = "up"
  /\ StartAsk(p)
  /\ UNCHANGED <<refs, stream, status, members, link, drops, keyFault, stale,
                 appliedId, invAt, invReturned>>

(* reask 844: invalidate(part). A parked part wakes: its stream opens again,
   and the stream's first signal asks. Any other part asks now. The caller
   awaits the asks it started (invAt). *)
YouInvalidate(p) ==
  /\ InUse(p) /\ invAt[p] = 0
  /\ invAt' = [invAt EXCEPT ![p] = nextId]
  /\ IF stream[p] = "parked"
       THEN /\ stream' = [stream EXCEPT ![p] = "opening"]
            /\ UNCHANGED <<asks, nextId, lastStarted>>
       ELSE /\ StartAsk(p)
            /\ UNCHANGED stream
  /\ UNCHANGED <<refs, status, members, link, drops, keyFault, stale,
                 appliedId, invReturned>>

(* reask 852: the invalidate's promise settles once its asks have settled
   (settle 824 waits for later asks too). *)
InvalidateReturns(p) ==
  /\ invAt[p] > 0
  /\ ~\E a \in asks : a.p = p /\ a.id >= invAt[p]
  /\ invAt' = [invAt EXCEPT ![p] = 0]
  /\ invReturned' = (invReturned \/ (InUse(p) /\ appliedId[p] < invAt[p]))
  /\ UNCHANGED <<refs, stream, status, members, asks, nextId, link, drops,
                 keyFault, lastStarted, stale, appliedId>>

(* settle 821-822, apply 828: an answer or a fault; dropped when a later ask
   of the part started or the part is not in use. *)
Settle(a, kind) ==
  /\ asks' = asks \ {a}
  /\ IF ~a.newer /\ InUse(a.p)
       THEN /\ status' = [status EXCEPT ![a.p] = kind]
            /\ members' = IF kind = "ready" THEN [members EXCEPT ![a.p] = TRUE]
                          ELSE members
            /\ keyFault' = IF kind = "ready" THEN "none" ELSE kind
            /\ appliedId' = [appliedId EXCEPT ![a.p] = a.id]
            /\ stale' = (stale \/ a.id # lastStarted[a.p])
       ELSE UNCHANGED <<status, members, keyFault, appliedId, stale>>

AskAnswered(i) ==
  \E a \in asks :
    /\ a.id = i /\ link = "up"
    /\ Settle(a, "ready")
    /\ UNCHANGED <<refs, stream, nextId, link, drops, lastStarted, invAt, invReturned>>

AskRefused(i) ==
  \E a \in asks :
    /\ a.id = i /\ link = "up"
    /\ Settle(a, "refused")
    /\ UNCHANGED <<refs, stream, nextId, link, drops, lastStarted, invAt, invReturned>>

(* The link drops: every watch and every call in flight fails with link, at
   once (a socket that closes). Per part, only its newest ask can apply. *)
Newest(p) == {a \in asks : a.p = p /\ ~a.newer}
Hit(p) == InUse(p) /\ (Newest(p) # {} \/ stream[p] \in {"opening", "open"})
LinkDrops ==
  /\ link = "up" /\ drops < MaxDrops
  /\ link' = "down" /\ drops' = drops + 1
  /\ asks' = {}
  /\ stream' = [p \in P |-> IF stream[p] \in {"opening", "open"} THEN "backoff"
                            ELSE stream[p]]
  /\ status' = [p \in P |-> IF Hit(p) THEN "link" ELSE status[p]]
  /\ keyFault' = IF \E p \in P : Hit(p) THEN "link" ELSE keyFault
  /\ appliedId' = [p \in P |->
       IF ~Hit(p) THEN appliedId[p]
       ELSE IF stream[p] \in {"opening", "open"} THEN 0
       ELSE (CHOOSE a \in Newest(p) : TRUE).id]
  /\ UNCHANGED <<refs, members, nextId, lastStarted, stale, invAt, invReturned>>

AskLinkFault(i) ==
  \E a \in asks :
    /\ a.id = i /\ link = "down"
    /\ Settle(a, "link")
    /\ UNCHANGED <<refs, stream, nextId, link, drops, lastStarted, invAt, invReturned>>

(* follow 893-895: a link fault; the stream waits, then opens again. *)
StreamLinkFault(p) ==
  /\ stream[p] \in {"opening", "open"} /\ link = "down"
  /\ StreamFault(p, "link", "backoff")
  /\ UNCHANGED <<refs, members, asks, nextId, link, drops, lastStarted, stale,
                 invAt, invReturned>>

LinkReturns ==
  /\ link = "down"
  /\ link' = "up"
  /\ UNCHANGED <<refs, stream, status, members, asks, nextId, drops, keyFault,
                 lastStarted, stale, appliedId, invAt, invReturned>>

(* follow 895: the back-off sleep ends; the stream opens again. *)
StreamRetries(p) ==
  /\ stream[p] = "backoff" /\ link = "up"
  /\ stream' = [stream EXCEPT ![p] = "opening"]
  /\ UNCHANGED <<refs, status, members, asks, nextId, link, drops, keyFault,
                 lastStarted, stale, appliedId, invAt, invReturned>>

Next ==
  \/ \E p \in P : ReaderReads(p)
  \/ \E p \in P : ReaderLeaves(p)
  \/ \E p \in P : StreamOpens(p)
  \/ \E p \in P : StreamRefused(p)
  \/ \E p \in P : ServerSignals(p)
  \/ \E p \in P : YouInvalidate(p)
  \/ \E p \in P : InvalidateReturns(p)
  \/ \E p \in P : StreamLinkFault(p)
  \/ \E p \in P : StreamRetries(p)
  \/ \E i \in 1..MaxAsks : AskAnswered(i)
  \/ \E i \in 1..MaxAsks : AskRefused(i)
  \/ \E i \in 1..MaxAsks : AskLinkFault(i)
  \/ LinkDrops \/ LinkReturns

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
(* Rules. Each one is a line of an ADR. *)

(* ADR 0139 d1: a part has its own state: not read yet, ready, or a fault. *)
PartInUseHasState ==
  \A p \in P : InUse(p) => status[p] \in {"pending", "ready", "refused", "link"}

(* ADR 0136 d3 ("Nothing stays for a part with no reader") and
   ADR 0138 d16 ("A part with no reader is dropped at once"). *)
NothingForNoReader ==
  \A p \in P : ~InUse(p) => (status[p] = "none" /\ ~members[p] /\ stream[p] = "off")

(* ADR 0137 d3: the last ask wins; an answer is dropped when a later ask of
   that part has started. *)
LastAskWins == ~stale

(* ADR 0139 d4 (and ADR 0140, The direction): refused is the server's answer;
   the part goes to fault and waits for a trigger. Core does not ask again by
   itself. So while a refused part waits, its fault stands. *)
RefusedWaitsForTrigger ==
  [][\A p \in P : (stream[p] = "parked" /\ status[p] = "refused")
       => status'[p] \in {"refused", "none"}]_vars

(* ADR 0139 d4: a broken link is not an answer; the backend heals it; the
   part shows link until then. ADR 0141 (the table): "A link on a read
   heals: the backend watches again." So a part that shows link still has a stream
   that comes back with the link (ADR 0140: its watch says "all dirty"). *)
LinkFaultHeals ==
  \A p \in P : status[p] = "link" => stream[p] \in {"opening", "open", "backoff"}

(* ADR 0147 d4 ("To see your own write, invalidate": await invalidate, then
   read) and ADR 0137 d2 (invalidate marks the part dirty and asks again):
   when an awaited invalidate returns, an ask it started set the state. *)
InvalidateAwaitsItsAsk == ~invReturned

=============================================================================
