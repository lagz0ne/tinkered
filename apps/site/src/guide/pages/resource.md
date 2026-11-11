# Resource

A resource is a thing with a life: a socket, a
timer, a compiler. The scope builds it once and
runs its cleanup on close.

```ts
const ticker = resource({
  label: "sea.ticker",
  depends: { frames },
  factory: ({ frames }, { defer }) => {
    const id = frames.request(tick);
    defer(() => frames.cancel(id));
    return { running: true };
  },
});
```

- `defer` adds cleanup. Close runs it, last
  first.
- The value is the small shape its users call,
  not the whole thing behind it.
- A test swaps a heavy resource with a preset:

```ts
createScope({
  capsules: [play.build({})],
  presets: [preset(compiler, fakeCompiler)],
});
```

## Not in React

A resource replaces `useEffect`. React reads
cells and runs ops. It holds no effect of its
own.
