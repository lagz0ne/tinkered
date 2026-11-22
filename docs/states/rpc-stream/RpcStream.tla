----------------------------- MODULE RpcStream -----------------------------
(* One rpc stream call and its reader, as the code on origin/main c9c88174
   has it: packages/core/src/rpc.ts pull 220, the remote path 363-390
   (watch with its own leave signal), runHere 406-450 (a channel, and a
   listener on the call's signal); rpc-protocol.ts watchOver 159-178 and
   bug 196 (a throw in the watch is `failed`); memory.ts open 251.
   A call goes to a server (remote) or runs here (implement), with or
   without a caller's signal. The op sends up to MaxPush values. Core runs
   a call with a signal in its own child session (ADR 0090); that session
   answers when its work ends. Probed on the real code before modelling:
   statechart/core4/rpc-stream/probe.md. *)
EXTENDS Naturals

(* Fetch = FALSE: the code before ADR 0169 (main 74211a57): a call with a
   signal or tags runs in its own child session (ADR 0090), which ends when
   the call answers. Fetch = TRUE: ADR 0169, the fetch rule: a stream call
   opens no child session; the signal stops the stream, the tags bind its
   run. *)
CONSTANTS MaxPush, Fetch

VARIABLES
  path,      \* remote or here
  hasSignal, \* the caller passed a signal
  hasTags,   \* the caller passed tags
  call,      \* pending (no iterable yet) or answered
  src,       \* the op: running, done (returned), closed (its channel closed)
  q,         \* values sent and not read yet
  pushed,    \* values sent so far
  endWith,   \* how the stream ends after its values: clean, link, failed, abort
  reader,    \* none (not reading yet), reading, ended, threw, left
  got,       \* what the reader's loop got at its end: none, clean, link, failed, abort
  signal,    \* live or aborted
  link,      \* up or closed (remote only)
  cutBy      \* ghost: what stopped the op first: none, op, break, signal, link

vars == <<path, hasSignal, hasTags, call, src, q, pushed, endWith, reader, got, signal, link, cutBy>>

Init ==
  /\ path \in {"remote", "here"} /\ hasSignal \in BOOLEAN /\ hasTags \in BOOLEAN
  /\ call = "pending" /\ src = "running" /\ q = 0 /\ pushed = 0
  /\ endWith = "clean" /\ reader = "none" /\ got = "none"
  /\ signal = "live" /\ link = "up" /\ cutBy = "none"

Reading == reader \in {"none", "reading"}

(* A signal or tags give the call its own child session (ADR 0038, 0090),
   unless Fetch (ADR 0169 d1). *)
Session == ~Fetch /\ (hasSignal \/ hasTags)

(* Before ADR 0169: here, the op is the session's work, so the call answers
   only once the op ends. Remote, the session ends at the answer and stops
   the watch: the stream is cut, and the watch's catch ends it clean. With
   Fetch, the call answers at once and nothing stops. *)
CallAnswers ==
  /\ call = "pending"
  /\ (path = "remote" \/ ~Session \/ src # "running")
  /\ call' = "answered"
  /\ src' = IF path = "remote" /\ Session /\ src = "running" THEN "closed" ELSE src
  /\ cutBy' = IF path = "remote" /\ Session /\ src = "running" THEN "answer" ELSE cutBy
  /\ UNCHANGED <<path, hasSignal, hasTags, q, pushed, endWith, reader, got, signal, link>>

OpSends ==
  /\ src = "running" /\ pushed < MaxPush
  /\ q' = q + 1 /\ pushed' = pushed + 1
  /\ UNCHANGED <<path, hasSignal, hasTags, call, src, endWith, reader, got, signal, link, cutBy>>

OpEnds ==
  /\ src = "running"
  /\ src' = "done" /\ cutBy' = "op"
  /\ UNCHANGED <<path, hasSignal, hasTags, call, q, pushed, endWith, reader, got, signal, link>>

ReaderGetsValue ==
  /\ call = "answered" /\ Reading /\ q > 0
  /\ q' = q - 1 /\ reader' = "reading"
  /\ UNCHANGED <<path, hasSignal, hasTags, call, src, pushed, endWith, got, signal, link, cutBy>>

(* pull 249-250: no value left and the source ended: the loop ends, or
   throws the fault the stream ended with. *)
ReaderLoopEnds ==
  /\ call = "answered" /\ Reading /\ q = 0 /\ src # "running"
  /\ reader' = IF endWith = "clean" THEN "ended" ELSE "threw"
  /\ got' = endWith
  /\ UNCHANGED <<path, hasSignal, hasTags, call, src, q, pushed, endWith, signal, link, cutBy>>

(* pull 256-259: a break; `end` aborts leave (remote: the watch's signal;
   here: the channel's closed). *)
ReaderBreaks ==
  /\ call = "answered" /\ Reading
  /\ reader' = "left"
  /\ src' = IF src = "running" THEN "closed" ELSE src
  /\ cutBy' = IF src = "running" THEN "break" ELSE cutBy
  /\ UNCHANGED <<path, hasSignal, hasTags, call, q, pushed, endWith, got, signal, link>>

(* The caller's signal aborts. Before ADR 0169, its child session closes:
   remote, the watch's catch sees the call's own stop and ends clean (bug 14
   fix); here, the op's run rejects with Core's AbortError. With Fetch, the
   signal aborts the stream's leave, as a break does: the channel closes and
   the op ends; the watch's catch sees the leave and ends clean. *)
SignalAborts ==
  /\ hasSignal /\ signal = "live"
  /\ signal' = "aborted"
  /\ src' = IF src = "running" THEN "closed" ELSE src
  /\ endWith' = IF src = "running" /\ reader # "left" /\ path = "here" /\ ~Fetch
                  THEN "abort"
                  ELSE endWith
  /\ cutBy' = IF src = "running" THEN "signal" ELSE cutBy
  /\ UNCHANGED <<path, hasSignal, hasTags, call, q, pushed, reader, got, link>>

(* memory open 265: the server goes away; the open ends as `gone`, a link
   fault, pushed last (watchOver 177). *)
LinkCloses ==
  /\ path = "remote" /\ link = "up"
  /\ link' = "closed"
  /\ src' = IF src = "running" THEN "closed" ELSE src
  /\ endWith' = IF src = "running" /\ reader # "left" THEN "link" ELSE endWith
  /\ cutBy' = IF src = "running" THEN "link" ELSE cutBy
  /\ UNCHANGED <<path, hasSignal, hasTags, call, q, pushed, reader, got, signal>>

Finished == reader \in {"ended", "threw", "left"}
Done == Finished /\ UNCHANGED vars

Next ==
  \/ CallAnswers \/ OpSends \/ OpEnds \/ ReaderGetsValue \/ ReaderLoopEnds
  \/ ReaderBreaks \/ SignalAborts \/ LinkCloses \/ Done

Spec == Init /\ [][Next]_vars

----------------------------------------------------------------------------
(* Rules. Each one is a line of an ADR. *)

(* ADR 0133 d4: "rpc gives a watch only its own stop signal. The caller's
   signal already stops it: the call's child session owns the watch." *)
CallerSignalEndsStream == signal = "aborted" => src # "running"

(* ADR 0133 d4 and its proof ("a stream left by `break`"): a reader that
   leaves ends the watch. *)
BreakEndsStream == reader = "left" => src # "running"

(* ADR 0133 d1: a call stopped by its own signal is a cancellation for its
   caller. ADR 0154 d2 and ADR 0141: `failed` says a throw, a bug. So a
   stream that the caller's own signal stopped never ends as `failed`. *)
OwnStopIsNotFailed == cutBy = "signal" => got # "failed"

(* ADR 0141 (the table): a link after the call left is `link`, local,
   sent: true. ADR 0154 d2: an exit is a fault. So a stream whose link
   closed while it ran never ends clean for its reader. *)
LinkCloseIsLink ==
  (cutBy = "link" /\ reader \in {"ended", "threw"}) => got = "link"
(* ADR 0169 d1: "The call answers with the reader at once": whatever the op
   does, the call can answer. *)
AnswersAtOnce == call = "pending" => ENABLED CallAnswers

(* ADR 0169 d1: "The stream lives with the caller's owner": the answer
   never stops it. *)
AnswerKeepsStream == cutBy # "answer"

(* ADR 0169 d2: the caller's signal stops the stream as a break does, and
   the loop ends clean (ADR 0133 d1: a cancellation). *)
SignalEndsClean ==
  (cutBy = "signal" /\ reader \in {"ended", "threw"}) => got = "clean"
=============================================================================
