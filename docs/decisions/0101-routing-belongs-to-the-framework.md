# 0101 Routing belongs to the framework

Date: 2026-10-03. Status: accepted.

## Context

The flight-trial services route inside Tinker.
One operation takes a whole HTTP request and picks the work by route name.
So every operation sees a bigger input than it needs.

The user ruled that routing stays in the framework.
A framework such as Hono or TanStack Start already routes, validates,
and is tuned for it.

## Decision

The framework owns routes.
Middleware puts the request's scope where the handler can reach it.
Each handler reads only the params its operation needs,
then calls `.run` on that one operation.

No operation takes a whole request or picks work by route name.
An operation's input is exactly its params.

The Start scaffold already works this way through server functions and routes.
