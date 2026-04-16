# Angular SSR Animation Engine — Teardown Investigation

Investigation of whether `TransitionAnimationEngine` leaks memory under SSR.

## Hypothesis

When a component uses animation triggers, `TransitionAnimationEngine.destroy()` queues
cleanup callbacks into `_whenQuietFns` via `afterFlushAnimationsDone()`. These callbacks
release entries from `namespacesByHostElement` (which retains host DOM element references).

The queue is only drained by `engine.flush()`, which is only called from
`AnimationRendererFactory.end()` during change detection — **never during SSR teardown**.
The concern was that callbacks would accumulate and retain DOM nodes permanently.

## Findings

After running 50 sequential SSR requests the observed behaviour is:

```
[animation-leak] onDestroy: pendingCallbacks=0, retainedHostElements=0   ← request 1
[animation-leak] onDestroy: pendingCallbacks=1, retainedHostElements=0   ← requests 2–N
```

- **`pendingCallbacks` stays at 1, never grows.** `engine.flush()` is called during
  change detection at the start of each request, which drains the previous request's
  pending callback before a new one is queued. Nothing accumulates.
- **`retainedHostElements=0` throughout.** The `namespacesByHostElement` map is never
  populated with SSR-rendered elements (with `provideNoopAnimations()`), so there are
  no retained DOM node references.
- **Heap growth is consistent with normal GC deferral**, not a monotonic leak. The heap
  rises between GC cycles and drops when V8 collects; no unbounded growth is observed.

**Conclusion: this does not appear to be a memory leak.** The teardown ordering is
off-by-one (the last request's cleanup runs at the start of the next request rather than
at teardown), but the count never grows and nothing is permanently retained.

## What the probe measures

```bash
npm install
npm run build
node dist/animations-memory-leak/server/server.mjs
```

In another terminal:

```bash
for i in $(seq 1 50); do curl -s http://localhost:4000/ > /dev/null; done
```

The `[animation-leak] onDestroy` lines show the state of `_whenQuietFns` and
`namespacesByHostElement` at the moment the environment injector is destroyed, which is
**before** `TransitionAnimationEngine.destroy()` queues the current request's callback.

## Workaround

Uncomment the workaround in `src/app/app.config.server.ts` to flush `_whenQuietFns`
explicitly at teardown (drives both values to 0 on every request).

## Code paths investigated

- `TransitionAnimationEngine.destroy()` — queues to `_whenQuietFns` instead of running
  cleanup directly
- `TransitionAnimationEngine.flush()` — the only place `_whenQuietFns` is drained
- `AnimationRendererFactory.end()` — the only caller of `engine.flush()`, triggered by
  `ApplicationRef.tick()`
