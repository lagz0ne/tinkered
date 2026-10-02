# Todo input and flow-state brief

Read [the fixed brief](../contributor-brief.md)
and [the proof brief](POC-BRIEF.md).
Use `coding-convention` and the installed Start guides already loaded.

Work in `/tmp/tinkered-start-poc` on `start/poc` from `0ef74c28`.
The lead owns the board, track, graph, and source preview.
Change `apps/start-scaffold/src/backend/todos.ts`
and `apps/start-scaffold/src/frontend/Todos.tsx` only.
Do not push, land main, or change shared judge labels.
No new package, dependency, release lane, or mutation lane.

The user wants the write input to come from its declaration.
`writeTodo` currently spells its shape on `Operation.Ctx`.
Reuse `input: readTodoChange` on that operation instead.
Its callback must infer `ctx.input` with no type annotation or cast.
Depend on the `currentUser` resource alongside `transaction`.
Use `currentUser.id` to filter and create rows.
Its input is just the todo change; no owner ID in that input.

Keep public `changeTodo` dependent on `currentUser` and the write operation.
That resource must resolve before the write can start its transaction.
The body forwards its already-read `ctx.input` through trusted `input`.
That internal call skips another parse.
No extra schema, reader, identity function, or operation helper.
Add a short TSDoc only if the dependency order needs a why.
Leave profile and unrelated UI work outside this focused correction.

The user also wants states shown with distinct object cases.
Replace the separate todo pending and message cells with one Core data value.
Its type is an object union:

```ts
{ kind: "idle" }
| { kind: "saving" }
| { kind: "failed"; message: string }
```

Start at idle.
The save action enters saving; cleanup returns it to idle.
The failure action enters failed with the managed input message or retry text.
Input refusal happens before the save body and must still enter failed.
A valid retry clears that failure by entering saving.
The view reads this one value and narrows on `kind`.
Remove the old pending and message cells and their controllers.
Do not add React state or keep extra booleans in Core data.
Derived UI booleans are fine.
Keep route loading owned by Start and saved rows owned by the loader.
Do not copy those rows into this flow state.
The type can be a small inline union on `data`; no new schema or helper is needed.
Keep the clear input message and the current form behavior.

The only caller of private `writeTodo` is public `changeTodo`.
Existing public tests cover two accounts, guessed IDs,
signed-out writes before transactions, and raw input refusal.
Use those tests; do not add one that only checks TypeScript inference.

Run app build, check, eleven tests, strict census, TSDoc, and advisory Jev.
The lead checks saving, input refusal, a valid retry, and account isolation in a browser.
No new transport check is needed: no Start boundary or middleware changes.
Commit the explicit source path after checks pass.
Keep the live preview running for the lead.
Report exit codes and the graph's auth-before-write order.
