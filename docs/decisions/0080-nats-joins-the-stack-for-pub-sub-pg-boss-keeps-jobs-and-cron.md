# 0080 NATS joins the stack for pub/sub; pg-boss keeps jobs and cron

Date: 2026-09-29. Status: accepted. Changes: 0074 §6 (the v1 box gains NATS). Builds on: 0075
(jobs are pg-boss), 0076 (the trace id). Research: `docs/roadmap/stack-v1/RESEARCH.md`, round 3.

## Context

The user runs NATS in most projects and wants it in the stack as its own package. Uploads, cron,
and jobs could move onto it later. The facts that shaped v1:

- A NATS publish cannot join a Postgres transaction. Jobs on JetStream would need an outbox, and
  no Node library for one exists.
- JetStream has no dead-letter queue, and by default it retries forever.
- pg-boss adds a job inside the request's transaction for free (ADR 0075). It also has cron:
  `schedule(name, cron)`.
- Object Store has no presigned URLs, so upload bytes pass through our server. NATS's own advice
  is to keep big files in S3 and send a reference.

**The precedent is NestJS and Moleculer.** Both ship NATS to carry calls and events between
processes. Moleculer puts lasting queues on JetStream in a separate package.

## Decision

1. **`@tinker/nats` is a new package, and the stack includes it.** It uses the `@nats-io/*` v3
   client.
2. **In v1 it carries pub/sub:** messages between server processes, and app events.
3. **pg-boss keeps jobs and cron.**
4. **Uploads are not in v1.**
5. **Tests run a real `nats-server`.** No in-process server exists, and the binary is ready in
   about 6 ms.
6. **We carry the trace ourselves.** Each message gets a `traceparent` header (ADR 0076). The JS
   client does not set it, and no OTel plugin for NATS exists.

## Consequences

- Dev and tests need the `nats-server` binary. An app that drops `@tinker/nats` does not.
- Jobs on NATS later would mean an outbox table plus a relay. Revisit after two apps run on the
  stack.

## Options considered

- **Jobs and cron on NATS in v1.** Rejected: we would write the outbox and the dead-letter queue
  ourselves, and lose the free add inside the request's transaction.
