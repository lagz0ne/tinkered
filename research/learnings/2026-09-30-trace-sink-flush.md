# Trace sink: encode at flush

A core observation sink runs while the span closes.
Reading lazy W3C ids and encoding OTLP there adds that work
to every request.

Keep the finished span or log reference in a count-bounded queue.
Read ids and encode attributes only when that queue flushes.
Apply the byte cap to the records in that batch.
A full queue rejects a new reference before encoding anything.

The public callback probe is `bench/trace-sink.mjs`.
It queues 1024 fresh spans in each of 61 measured batches,
after 10 warmup batches.
All 72,704 spans must reach the local HTTP collector.
Setup, HTTP, and close sit outside the measured callback.

Both runs used `benchctl exec` under `/tmp/mutation.lock`.
The old run included lazy id reads and encoding:
minimum 2,726 ns/span, median 3,057, p95 6,809.
The run at `9c964de1` measured reference queueing:
minimum 47 ns/span, median 93, p95 197.
Both runs delivered every span.
These are separate cost probes, not an interleaved A/B verdict.
The encode cost moved to flush; it did not vanish.

Close has two distinct jobs.
Forced close aborts the active HTTP send and drops the queue.
Graceful close joins the active batch and sends the last records
within one shared second, counted from the close hook.
The scope clock drives that deadline.
Tests advance it and count collector requests, with no sleep
or machine-speed bound.
