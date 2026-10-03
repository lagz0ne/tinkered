# 0098 Trial services are Tinker apps behind HTTP

Date: 2026-10-03. Status: accepted.
Replaces the service part of ADR 0097.
Its data, rounds, and score stay.

## Context

ADR 0097 planned stripe-mock and a separate webhook sender.
stripe-mock is stateless, so it cannot hold a payment's state.

The user chose to build each fake service from the trial data instead.
Data holds its state; writes control it; watchers react.
`preset` seeds a scenario at the start.

The user also chose to test only through seams.
The app and the grader both reach a service over HTTP.
Neither reads a service's data directly.

## Decision

Each fake service is its own Tinker app.
It runs in its own scope and process, outside the app's scope:

- payment, shaped like Stripe;
- three suppliers, shaped like Duffel's API.

Each service exposes two HTTP faces:

- the service API, which the app calls with real clients;
- a control API, which only the grader calls.

Behind the control API, the service writes its own data.
It can also start a `preset` scenario or move its own clock.
Watchers push webhooks and price changes to the app over HTTP.

Postgres and Mailpit stay real.
The app's own code runs unchanged; nothing in its scope is replaced.

## Consequences

The app runs on real time.
Its holds use short durations set by tags.
A service's clock moves only through its control API.
