<!-- Under-scoped variant of the cli/t04 impact block (eval fixture for ADR 0047):
     `commands` limited to src/index.ts, so tests/cli.test.ts and examples/basic.ts
     are unexpected discrepancies (each should judge PLAN wrong). Other lines unchanged. -->

```impact cli/t04
cli  readCommand  src/index.ts
cli  commands     src/index.ts
cli  readRun      src/index.ts
```
