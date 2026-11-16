----------------------------- MODULE RpcCall -----------------------------
(* One client, one server, the ws link (packages/bun/src/client.ts), Core's protocol
   (packages/core/src/rpc-protocol.ts callOver, renewed) and rpc (packages/core/src/rpc.ts
   sendKey), on origin/main 3ff67780. Two calls.
   - rpc makes one execution id per call; callOver sends the same input again after a renew.
   - ws `post` puts a message in the frame buffer (`out`); the next tick sends the frame on the
     socket, opening one if there is none.
   - A socket close runs `drop`: every waiter fails as `link`, `sent` = its message left.
     `drop` does not clear the frame buffer.
   - The server runs a message it got, binds the execution tag, and replies. A reply with no
     waiter is dropped. *)
EXTENDS Naturals, FiniteSets

CONSTANTS Calls, MaxCloses, Outcomes

VARIABLES
  link,       \* none, opening, up
  closes,     \* how many times the link closed
  phase,      \* per call: idle, asking (a waiter waits), renewing, resending, ended
  attempt,    \* per call: 0, 1, 2
  msg,        \* per call, its newest message: none, queued (frame buffer), opening (waits for
              \* the socket), sent (left), answered (reply on the way), stray (left on a socket
              \* that closed: the server may still run it)
  msgAttempt, \* per call: the attempt of that message
  reply,      \* per call: the server's answer on the way: none, value, refused, failed
  ran,        \* per call: the attempts the server ran
  exec,       \* per call: the execution id rpc made (0 = none yet)
  sentIds,    \* per call: the execution ids its messages carried
  serverIds,  \* per call: the execution tags the server bound
  ended,      \* per call: none, value, refused, failed, linkSent, linkUnsent
  endAttempt, \* per call: the attempt it ended on
  ends,       \* per call: how many times it ended
  faultId,    \* per call: the execution id on its fault (0 = none)
  renew,      \* idle, busy (one renew at a time for the client)
  renewFor,   \* the calls that wait for that renew
  badRenew    \* ghost: a renew began for something that was not a refusal

vars == <<link, closes, phase, attempt, msg, msgAttempt, reply, ran, exec, sentIds, serverIds,
          ended, endAttempt, ends, faultId, renew, renewFor, badRenew>>

Waiting(c) == phase[c] = "asking" /\ msgAttempt[c] = attempt[c] /\ msg[c] /= "none"

Init ==
  /\ link = "none" /\ closes = 0
  /\ phase = [c \in Calls |-> "idle"]
  /\ attempt = [c \in Calls |-> 0]
  /\ msg = [c \in Calls |-> "none"]
  /\ msgAttempt = [c \in Calls |-> 0]
  /\ reply = [c \in Calls |-> "none"]
  /\ ran = [c \in Calls |-> {}]
  /\ exec = [c \in Calls |-> 0]
  /\ sentIds = [c \in Calls |-> {}]
  /\ serverIds = [c \in Calls |-> {}]
  /\ ended = [c \in Calls |-> "none"]
  /\ endAttempt = [c \in Calls |-> 0]
  /\ ends = [c \in Calls |-> 0]
  /\ faultId = [c \in Calls |-> 0]
  /\ renew = "idle" /\ renewFor = {}
  /\ badRenew = FALSE

\* rpc makes the id (ctx.random.uuid()) and runs remote.call; ws posts the message.
CallSent(c) ==
  /\ phase[c] = "idle"
  /\ phase' = [phase EXCEPT ![c] = "asking"]
  /\ attempt' = [attempt EXCEPT ![c] = 1]
  /\ exec' = [exec EXCEPT ![c] = c]
  /\ msg' = [msg EXCEPT ![c] = "queued"]
  /\ msgAttempt' = [msgAttempt EXCEPT ![c] = 1]
  /\ sentIds' = [sentIds EXCEPT ![c] = @ \cup {c}]   \* input.execution = the id
  /\ UNCHANGED <<link, closes, reply, ran, serverIds, ended, endAttempt, ends, faultId, renew,
                 renewFor, badRenew>>

\* The next tick sends the frame buffer: on the open socket, or it opens one (`opening ??=`).
FrameGoesOut ==
  /\ \E c \in Calls : msg[c] = "queued"
  /\ link' = IF link = "none" THEN "opening" ELSE link
  /\ msg' = [c \in Calls |-> IF msg[c] = "queued"
                               THEN (IF link = "up" THEN "sent" ELSE "opening")
                               ELSE msg[c]]
  /\ UNCHANGED <<closes, phase, attempt, msgAttempt, reply, ran, exec, sentIds, serverIds,
                 ended, endAttempt, ends, faultId, renew, renewFor, badRenew>>

LinkOpens ==
  /\ link = "opening"
  /\ link' = "up"
  /\ msg' = [c \in Calls |-> IF msg[c] = "opening" THEN "sent" ELSE msg[c]]
  /\ UNCHANGED <<closes, phase, attempt, msgAttempt, reply, ran, exec, sentIds, serverIds,
                 ended, endAttempt, ends, faultId, renew, renewFor, badRenew>>

(* The socket closes: drop fails every waiter as link, sent = its message left (`gone`).
   A frame that waited for this socket is dropped. The frame buffer is not cleared. *)
LinkCloses ==
  /\ link /= "none" /\ closes < MaxCloses
  /\ link' = "none"
  /\ closes' = closes + 1
  /\ LET fails == {c \in Calls : Waiting(c)}
         left(c) == msg[c] \in {"sent", "answered"}
     IN /\ phase' = [c \in Calls |-> IF c \in fails THEN "ended" ELSE phase[c]]
        /\ ended' = [c \in Calls |-> IF c \in fails
                                       THEN (IF left(c) THEN "linkSent" ELSE "linkUnsent")
                                       ELSE ended[c]]
        /\ endAttempt' = [c \in Calls |-> IF c \in fails THEN attempt[c] ELSE endAttempt[c]]
        /\ ends' = [c \in Calls |-> IF c \in fails THEN ends[c] + 1 ELSE ends[c]]
        /\ faultId' = [c \in Calls |-> IF c \in fails THEN exec[c] ELSE faultId[c]]
  /\ msg' = [c \in Calls |-> CASE msg[c] = "opening" -> "none"
                               [] msg[c] = "sent" -> "stray"
                               [] msg[c] = "answered" -> "none"
                               [] OTHER -> msg[c]]
  /\ reply' = [c \in Calls |-> IF msg[c] = "answered" THEN "none" ELSE reply[c]]
  /\ UNCHANGED <<attempt, msgAttempt, ran, exec, sentIds, serverIds, renew, renewFor, badRenew>>

\* The server runs the message (binding the execution tag) and answers: value, refused, failed.
ServerAnswers(c, out) ==
  /\ msg[c] \in {"sent", "stray"}
  /\ ran' = [ran EXCEPT ![c] = @ \cup {msgAttempt[c]}]
  /\ serverIds' = [serverIds EXCEPT ![c] = @ \cup {exec[c]}]
  /\ msg' = [msg EXCEPT ![c] = IF msg[c] = "sent" THEN "answered" ELSE "none"]
  /\ reply' = [reply EXCEPT ![c] = IF msg[c] = "sent" THEN out ELSE "none"]
  /\ UNCHANGED <<link, closes, phase, attempt, msgAttempt, exec, sentIds, ended, endAttempt,
                 ends, faultId, renew, renewFor, badRenew>>

EndCall(c, how) ==
  /\ phase' = [phase EXCEPT ![c] = "ended"]
  /\ ended' = [ended EXCEPT ![c] = how]
  /\ endAttempt' = [endAttempt EXCEPT ![c] = attempt[c]]
  /\ ends' = [ends EXCEPT ![c] = @ + 1]
  /\ faultId' = [faultId EXCEPT ![c] = IF how = "value" THEN 0 ELSE exec[c]]

(* The reply reaches the client. No waiter: dropped. A value or `failed` ends the call
   (faulted(answer, id)). A first `refused` asks the client's one renew; a second is the answer. *)
ReplyArrives(c) ==
  /\ msg[c] = "answered" /\ link = "up"
  /\ msg' = [msg EXCEPT ![c] = "none"]
  /\ reply' = [reply EXCEPT ![c] = "none"]
  /\ IF ~Waiting(c)
       THEN UNCHANGED <<phase, ended, endAttempt, ends, faultId, renew, renewFor, badRenew>>
     ELSE IF reply[c] = "refused" /\ attempt[c] = 1
       THEN /\ phase' = [phase EXCEPT ![c] = "renewing"]
            /\ renew' = "busy"
            /\ renewFor' = renewFor \cup {c}
            /\ badRenew' = (badRenew \/ reply[c] /= "refused")
            /\ UNCHANGED <<ended, endAttempt, ends, faultId>>
       ELSE /\ EndCall(c, reply[c])
            /\ UNCHANGED <<renew, renewFor, badRenew>>
  /\ UNCHANGED <<link, closes, attempt, msgAttempt, ran, exec, sentIds, serverIds>>

\* The shared renew ends: true lets each waiting call send once more; false ends them refused.
RenewEnds(ok) ==
  /\ renew = "busy"
  /\ renew' = "idle" /\ renewFor' = {}
  /\ IF ok
       THEN /\ phase' = [c \in Calls |-> IF c \in renewFor THEN "resending" ELSE phase[c]]
            /\ UNCHANGED <<ended, endAttempt, ends, faultId>>
       ELSE /\ phase' = [c \in Calls |-> IF c \in renewFor THEN "ended" ELSE phase[c]]
            /\ ended' = [c \in Calls |-> IF c \in renewFor THEN "refused" ELSE ended[c]]
            /\ endAttempt' = [c \in Calls |-> IF c \in renewFor THEN 1 ELSE endAttempt[c]]
            /\ ends' = [c \in Calls |-> IF c \in renewFor THEN ends[c] + 1 ELSE ends[c]]
            /\ faultId' = [c \in Calls |-> IF c \in renewFor THEN exec[c] ELSE faultId[c]]
  /\ UNCHANGED <<link, closes, attempt, msg, msgAttempt, reply, ran, exec, sentIds, serverIds,
                 badRenew>>

\* metaNow().then(ask): the same input (same execution id) goes out again, as a new message.
Resend(c) ==
  /\ phase[c] = "resending"
  /\ phase' = [phase EXCEPT ![c] = "asking"]
  /\ attempt' = [attempt EXCEPT ![c] = 2]
  /\ msg' = [msg EXCEPT ![c] = "queued"]
  /\ msgAttempt' = [msgAttempt EXCEPT ![c] = 2]
  /\ sentIds' = [sentIds EXCEPT ![c] = @ \cup {exec[c]}]
  /\ UNCHANGED <<link, closes, reply, ran, exec, serverIds, ended, endAttempt, ends, faultId,
                 renew, renewFor, badRenew>>

Done ==
  /\ \A c \in Calls : phase[c] = "ended" /\ msg[c] = "none"
  /\ UNCHANGED vars

Next ==
  \/ \E c \in Calls : CallSent(c)
  \/ FrameGoesOut
  \/ LinkOpens
  \/ LinkCloses
  \/ \E c \in Calls, out \in Outcomes : ServerAnswers(c, out)
  \/ \E c \in Calls : ReplyArrives(c)
  \/ RenewEnds(TRUE) \/ RenewEnds(FALSE)
  \/ \E c \in Calls : Resend(c)
  \/ Done

(* Fairness: once the link stops closing (MaxCloses bounds it), frames go out, the link opens,
   the server answers, replies arrive, the renew ends, a renewed call resends. *)
Fairness ==
  /\ WF_vars(FrameGoesOut)
  /\ WF_vars(LinkOpens)
  /\ \A c \in Calls : WF_vars(\E out \in Outcomes : ServerAnswers(c, out))
  /\ \A c \in Calls : WF_vars(ReplyArrives(c))
  /\ WF_vars(RenewEnds(TRUE) \/ RenewEnds(FALSE))
  /\ \A c \in Calls : WF_vars(Resend(c))

Spec == Init /\ [][Next]_vars /\ Fairness

-----------------------------------------------------------------------------
\* RULES

\* ADR 0147 decision 1: the client makes the id; a resend after renew keeps it.
ResendKeepsId == \A c \in Calls : Cardinality(sentIds[c]) <= 1

\* ADR 0147 decision 2: the server binds the caller's id to the run.
ServerBindsId == \A c \in Calls : serverIds[c] \subseteq sentIds[c]

\* ADR 0147 decision 3: a call ends at its reply, once; a value end is a reply the server made.
EndsOnce == \A c \in Calls : ends[c] <= 1 /\ (ended[c] = "value" => endAttempt[c] \in ran[c])

\* ADR 0147 decision 5: the fault has the id.
FaultHasId == \A c \in Calls : ended[c] \notin {"none", "value"} => faultId[c] = exec[c]

\* ADR 0154 decision 2 (one renew at a time) and the RenewOp doc it keeps ("runs when a call or
\* a push is refused"); commit 14402c8: renew only on a refusal; a close mid call is link.
RenewOnlyOnRefusal == ~badRenew

\* ADR 0141 (kept by ADR 0154: "exits, no safe retry"): `link`, `sent: false` means nothing
\* left, so nothing ran ("the one case that is safe to send again"). Commit 14402c8: a close
\* after the call left is `link`, `sent: true`.
UnsentNeverRuns ==
  \A c \in Calls : ended[c] = "linkUnsent" => endAttempt[c] \notin ran[c]

\* The task's rule, from ADR 0147 decision 3 (a call ends at its reply) and the ws client's
\* "when it drops, every call ... fails as a link fault": no call waits forever.
NoCallWaitsForever ==
  \A c \in Calls : (phase[c] \in {"asking", "renewing", "resending"}) ~> (phase[c] = "ended")
=============================================================================
