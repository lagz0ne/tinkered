# 0097 The flight trial uses real local services

Date: 2026-10-03. Status: accepted.

## Context

We want to know how far a model writer gets with the Start scaffold.
The user asked for a hard app: many users and many timelines.
The trial is a flight metasearch app.
It searches suppliers, holds a seat, takes payment, and sends mail.

The user chose services that are as real as possible.
The trial container still has no internet.
So every service runs locally, on a private network.

## Decision

Use these services:

- Database: Postgres in a container.
- Mail: Mailpit, a real SMTP server with an inbox API.
- Payment: stripe-mock plus our own signed webhook sender.
- Suppliers: three HTTP services shaped like Duffel's API.
  The shape is offer request, then offers, then order.

stripe-mock is stateless; its replies are fixed.
So the app learns payment results from webhooks only.
Real Stripe async payments work the same way.

Each fake service has a control endpoint for the grader.
It can delay, fail, or repeat a reply, and change prices or seats.
Real services run on wall time, so Core's test clock cannot skip ahead.
Short trial durations come from tags instead.

Flight data starts from OpenFlights airports, airlines, and routes.
A fixed seed extends them into schedules, fares, and seats.
The routes stopped updating in June 2014; they are a frozen seed.
The data is under the Open Database License.
The fixture credits OpenFlights and keeps that license.

## Rounds and score

The app grows over five rounds:
search, metasearch, hold, pay, and email.
A round counts only when it passes every check.
The run stops at the first failed round.
The number of passed rounds is the baseline.

## Options considered

- Stripe test mode is the real service.
  It needs internet and a secret key inside the sealed container.
- Fakes on Core's clock replay exactly and can skip ahead.
  They test less of the real wire.
- A toy supplier API is easier to grade.
  A writer can shortcut it.
