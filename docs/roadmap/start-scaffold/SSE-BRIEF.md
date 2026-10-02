# SSE for the Start base

Read the [fixed writer brief](../contributor-brief.md),
[accepted sync rules](STATE-SYNC.md), and current app code.
Apply coding-convention and the installed Start route/middleware guides.
The user asks to build SSE now; this is authorized work.

## Owner and scope

Use the existing `/tmp/tinkered-start-poc` worktree on `start/poc`.
Base app code is saved at `a8102d62`.
The lead owns registry packaging, shared docs, diagrams, source preview, and browser proof.
You own app source, tests, migrations, native check scripts, and the Node host shutdown fix.
Do not edit registry files/scripts, dependencies, lockfiles, Core, or other packages.
Do not push, merge, or run release/mutation lanes for this proof.
Keep the existing app preview running.

Main has new registry scripts and README text you must preserve on transfer.
Main also imports presets from `@tinker/core/testing`.
Your older worktree may need root Core imports locally; report every such adaptation.
Commit only explicit app paths after useful gates.

## Precedent and concrete graph

Use native HTTP SSE framing and a Start server route at `/api/sync`.
Keep bootstrap and mutation calls as native Start server functions.
Use one native browser EventSource connection for public and private changes together.
Use Postgres LISTEN/NOTIFY to wake the backend after commit.
Stored event revisions remain the source for delivery and reconnect replay.
No periodic database change query hidden behind the SSE connection.
No Redis, queue, other Tinker package, driver picker, or SQLite support.

Before coding, send the lead the concrete file split and owned resource/operation shape.
The lead has read the installed route and middleware guides.
Load them in your worktree before touching their code.

## Database notification and proof wiring

Add a checked-in Postgres migration for commit notifications.
A trigger on stored event insert avoids missing a change-producing writer.
A trigger on auth session changes can wake streams to recheck revoked sessions.
Notifications carry only a wake-up key, not private records or a final result.
Register LISTEN before replay reads; drain again if a notification arrives during the read.
Duplicate wake-ups and missed transient notifications must be harmless.
If the listener disconnects, close affected SSE streams so reconnect replays stored events.
Reconnect must establish a new listener before resuming delivery.
Use one listener per backend owner, not one connection per browser.
Handle listener errors with owned work; never an unhandled native event callback.

The database remains userland and lazy.
A narrow listen capability on its handle is allowed if needed to share the actual engine
with the PGlite proof adapter without a driver branch or a global current client.
Explain that actual shape first.
Native clients and notification subscriptions must have Core resource owners.
Do not pass a scope or Core context to a helper.

PGlite exposes native `listen()` and `unlisten()`.
The proof should receive notifications from real committed SQL changes.
Do not replace that with a manual publish call in production write operations.
Proof resource presets remain explicit opt-in host wiring.
Preserve the production Postgres and SMTP factories.

## SSE HTTP contract

Validate URL cursors and Last-Event-ID at the request door.
Keep the public/private cursor vector separate from execution ID.
Authenticate private data on the server; a supplied account ID grants no access.
Return a proper refusal before streaming for an unauthorized requested cursor.
Use `text/event-stream`, `Cache-Control: no-store`, and `X-Accel-Buffering: no`.
Use UTF-8 `event`, `id`, and `data` fields with a blank line between frames.
Resume from stored revisions; Last-Event-ID must not bypass the account guard.
No private cache, event IDs, or records may leak across accounts.

The stream must recheck the live auth session before sending private data.
The current-user resource is cached per request, so it cannot alone prove continued access
through a long-lived connection.
Use the auth resource/client to recheck persisted session validity during delivery.
Recheck during heartbeat/connection refresh too, so expiry is bounded while idle.
Session deletion should wake an existing stream promptly.
Send a typed account-change control frame and close when the account is gone or differs.
The browser clears old private records and loads a fresh snapshot through Start.
A bounded connection lease can refresh changed browser cookies.
Keep this concrete; no general permission system or transport options.

Heartbeats keep the HTTP connection alive; they are not change polling.
Use Core clock and borrowed entry/request stop signals for that work.
Apply native ReadableStream backpressure and bounded batches.
Bound any browser event queue; overflow must reconnect from applied cursors.
A slow reader cannot keep an unbounded array of private events in memory.

## Core and native host lifetime

Use the existing extension-owned Start middleware, globally and on the route.
It must stay deduplicated, context-bound, and fail-fast when not bound to a scope.
It retains the request session until response end or cancellation.
All stream state, waits, client subscriptions, timers, and native listeners have owners.
Only host entries/extensions create root/session lifetime and original stop signals.

Returning a Response must not leave a dropped background promise.
Do not await an infinite operation before returning its streaming Response.
Do not attach cleanup to a finished operation frame that owns the returned body.
Keep body work owned by the request resource/session until the host consumes or cancels it.

Use the original entry stop signal to end active stream waits during root shutdown.
Core graceful close waits for work; relying only on its managed scope signal can deadlock.
Native Node host shutdown currently waits for HTTP close before backend close.
SSE requires stopping acceptance, ending owned streams, then awaiting HTTP close.
A SIGTERM with an idle SSE connection must exit cleanly.
HMR must end old streams/listeners and let clients reconnect to the new graph.

## Browser and feature code

Rename/remove polling transport code rather than keeping unused fallback paths.
Bootstrap stays safe for SSR and starts SSE only after native hydration.
Keep feature actions, receipts, shared records, dirty drafts, and partial-mail rules.
Account change stops the old connection and ignores late messages.
Closing the tab closes EventSource and releases pending work.

Read network messages once at their operation reader.
Apply event batches in order before resolving matching execution waits.
Reconnect from the last applied cursor, not a cursor advanced only by receipt of a message.
Native EventSource automatic retry may be closed and replaced by owned reconnect if needed
so received-but-unapplied messages cannot be skipped.
No custom general SSE parser if native EventSource can do the browser framing.
Keep any necessary protocol methods in the owning resource, not helper wrappers.

## Useful proof

Keep domain tests at exported operation/resource seams; no full Start stack for them.
Add only distinct promises needed by this change.
Use real PGlite notifications, database transactions, and Better Auth.
No mocks, patches, or sleep-based tests.

Prove committed event delivery and rollback silence.
Prove subscribing before replay closes the read/wake race.
Prove replay from a supplied cursor and direct private cursor refusal.
Prove a held/slow stream, auth revocation, and cancel release owned work.
Preserve event-before-receipt, partial mail, dirty draft, and late old account tests.
Use native route/browser proof to check serialized SSE frames and middleware dedupe.
The lead will test two tabs, disconnect/replay, sign-out, HTTP headers, and Node shutdown.

Run build first, check, app tests, native middleware/import gates, authored census/TSDoc,
and advisory review.
The two existing proof-preset S16 exceptions remain explicit.
Report any additional unavoidable proof preset and its reason before finalizing.
No public Core API changes or all-package release lanes.
