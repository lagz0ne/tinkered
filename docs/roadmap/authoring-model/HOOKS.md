# One extension hook shape

Date: 2026-09-30.
Status: Doing.
Owner: lead (authoring session).
Writer model: Astra, xhigh; one package per writer.

## Goal

The user asked to remove legacy hooks and migrate all current extensions.
Use the existing object hook shape as the single API.
Keep middleware order, namespace access, results, and cleanup behavior.
Keep the fixed graph and lazy event rules.
Core's 16 KiB gzip cap remains in force.

```ts
const boot = extension({
  label: "boot",
  hooks: {
    async start(event) {
      await event.next();
    },
  },
});
```

## Impact before code

Public symbols: `extension`, `Scope.Extension`, and `Scope.Hooks`.
Remove top-level `start`, `resolve`, `run`, `write`, `close`, and `session`.
Keep those six verbs inside `hooks`, each taking one bound event.
Remove legacy dispatch and precedence branches from Core.
This is an intentional source API break authorized by the user.

Callers to migrate:

- Core's extension, session, lifetime, namespace, and signal tests.
  Its hook probe must stop constructing a legacy extension.
- MCP's driver and server tests.
- Hono's driver and lifetime tests.
- Stack's server, migrations, publication, and legacy trace wiring.
  Keep `traceSink(wiring)` itself; only its hook declarations change.
- NATS, Sync, Process, and Tinkerer tests.
  Their already-migrated runtime hooks stay unchanged.
- The tracker tool entry and client test.
- MCP and Process examples.
- Blueprint source fixtures and Jev authored-code fixtures, when found.
  Jev's existing body reader must find `hooks.start` for its same clock checks.
  Update that API path and its fixtures; keep the rule and judge bank unchanged.
- Current README and authoring guide examples.

Check named and imported aliases through SCIP before and after code.
Check object literals returned as `Scope.Extension`, too.
Historical decision records and past proof remain history.
Other teams' unpublished worktrees stay untouched.
The saved `core/start-log` branch changes the same dispatch area;
its next merge must use the object hook API.

## Writer brief

Read `docs/roadmap/contributor-brief.md` and the coding skill first.
Use one package per writer, in a private worktree based on this plan.
Lead owns docs, board, shared labels, integration, and all fault lanes.
Do not push or change a mutation setting or threshold.
Do not start mutation or timing; the lead runs those alone.
Do not edit shared Jev labels; report flags for the lead to judge together.

Migrate existing public behavior tests instead of adding duplicate cases.
Delete only tests whose sole promise is legacy compatibility or precedence.
Keep their useful behavior checks under the object form.
Do not replace `event.scope.resolve` with `event.resolve` blindly:
the first can enter root resolve middleware; the second bypasses it.
Keep scope and session payload handles when their behavior is needed.

Build first, then check and run the package and its consumer tests.
Core may report unmigrated consumers temporarily; name exact files.
Run strict style census, TSDoc, and advisory checks on changed units.
Do not fix old unrelated source or tests just to clear advisory notes.

## Proof

Pending: caller inventory, migration, normal gates, fault lanes, and landing.
