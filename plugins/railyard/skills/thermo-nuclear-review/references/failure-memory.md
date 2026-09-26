# Review lens: what does this remember when it fails?

Ordinary review keeps missing this defect class. Each example below shipped,
passed its own tests, and was caught only by a later reviewer.

The shape: code reaches a conclusion from a failure and keeps it. The failure
is handled (nothing crashes, nothing is dropped, the error may even be
classified), but the conclusion is wrong and durable. Tests pass because the
happy path is fine and the failure path returns something plausible.

For every failure branch, ask:

1. **What does this now believe?** Not what it returns, but what it records,
   caches, or decides that outlives the call.
2. **How long does it believe it?** A wrong belief with a TTL is a bug; one
   cached for the process lifetime is an outage that needs a restart.
3. **Was the failure evidence for that belief?** Downtime says nothing about a
   server's capabilities, and a cancelled request says nothing about
   availability.
4. **What happens on the next call?** If nothing re-probes, the first bad
   moment is permanent.

## Examples

**A blanket catch flattens distinct failures into one verdict.**

```js
try { ...probe... } catch { return null; }   // "inconclusive"
```

This swallowed a client cancellation: the caller had asked to stop, the code
treated it as "couldn't determine", and then ran the caller's mutating tool
call anyway. Cancellation is evidence about intent, not about the world.
Catch narrowly and re-throw what is not yours.

**A transient failure cached as a permanent fact.**

```js
if (err instanceof HttpRejected) { this.era = "legacy"; }
```

One 500 during the first probe pinned the wrong protocol era for the process
lifetime; every later connection skipped discovery and spoke a dialect the
server could not answer. A 5xx means the server failed, not that it answered.
Only a response proving the server understood you may become a durable
verdict.

**A stale answer served as fresh.** A tool list cached during downtime was
returned without a staleness marker to a client told the list never changes,
and the client believed the empty list for its whole session. Serving stale
data during an outage is often right; serving it unlabelled is not.

**A partial result committed as complete.** A paginated walk that hit its page
cap cached the truncated list and diffed against it, reporting that tools had
disappeared. A walk that did not finish learned nothing; treat incomplete like
unreachable and do not commit it.

## Why tests miss these

The failure path returns something, so nothing throws and coverage looks fine.
Three habits help:

- **Sabotage the fix and re-run.** If the test still passes, it never tested
  the behavior. This caught three hollow tests in one session, including one
  asserting against a fallback path that set the same fields inline.
- **Assert on the belief, not the return value.** `shim.backendEra === null`
  is the property that matters; the returned value was never wrong.
- **Construct the failure instead of waiting for it.** A test that skips when
  it cannot produce the condition is a green result with no evidence.

## Code that deserves a second look

- `catch {` with no binding, or `catch (e) {}` that inspects nothing
- any assignment to durable state inside a `catch`
- a cache write on a path that did not confirm success
- `|| default` / `?? fallback` where the fallback is remembered, not just used
- "if we can't tell, assume X": assuming under uncertainty is fine; recording
  the assumption as fact is the bug
