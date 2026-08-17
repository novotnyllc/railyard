# Review lens: what does this remember when it fails?

A distinct defect class, worth its own pass because ordinary review keeps
missing it. Every finding below is real — each one shipped, passed its own
tests, and was caught only by a later reviewer.

The shape: **code that reaches a conclusion from a failure and then keeps it.**
The failure is handled — nothing crashes, nothing is silently dropped, the
error is even classified — and the conclusion drawn from it is wrong and
durable. Tests pass because the happy path is fine and the failure path
"works": it returns something, and the something is plausible.

Ask of every failure branch:

1. **What does this now believe?** Not "what does it return" — what does it
   record, cache, or decide that outlives this call?
2. **How long does it believe it?** A wrong belief with a TTL is a bug. A wrong
   belief cached for the process lifetime is an outage that needs a restart.
3. **Was the failure actually evidence for that belief?** Downtime is not
   evidence about a server's capabilities. A cancelled request is not evidence
   that anything is unavailable.
4. **What happens on the next call?** If it never re-probes, the first bad
   moment is permanent.

## The four questions, against real findings

**A blanket catch flattens distinct failures into one verdict.**

```js
try { ...probe... } catch { return null; }   // "inconclusive"
```

Swallowed a client cancellation. The caller had asked us to stop; the code
treated that as "couldn't determine", carried on, and ran the caller's mutating
tool call anyway. *Cancellation is never evidence about the world — it is
evidence about intent.* Catch narrowly, and re-throw what is not yours.

**A transient failure cached as a permanent fact.**

```js
if (err instanceof HttpRejected) { this.era = "legacy"; }
```

One 500 during the first probe pinned the wrong protocol era for the process
lifetime. Every later connection then skipped discovery and spoke a dialect the
server could not answer, with no recovery short of a restart. *A 5xx means the
server failed, not that it answered your question.* Only a response that proves
the server understood you may become a durable verdict.

**A stale answer served as a fresh one.**

A tool list cached during downtime was returned with no staleness marker, to a
client that had been told the list never changes. It believed that empty list
for its whole session. *Serving stale data during an outage is legitimate and
often correct — serving it unlabelled is not.*

**A partial result committed as a complete one.**

A paginated walk that hit its page cap wrote the truncated list to the cache and
diffed against it, reporting that tools had disappeared. *A walk that did not
finish learned nothing.* Treat incomplete like unreachable; do not commit it.

## Why tests miss these

The failure path returns *something*, so nothing throws and coverage looks fine.
Three habits catch what assertions do not:

- **Sabotage the fix and re-run.** If the test still passes, it never tested the
  behaviour. This caught three hollow tests in one session, including one where
  the assertion ran against a *fallback* path that set the same fields inline —
  so it passed with the real logic deleted.
- **Assert on the belief, not the return value.** `shim.backendEra === null` is
  the property that matters; the returned value was never wrong.
- **Construct the failure, do not wait for it.** A test that skips when it
  cannot produce the condition is a green result with no evidence behind it.

## Wording that should stop a reviewer

- `catch {` with no binding, or `catch (e) {}` that inspects nothing
- any assignment to durable state inside a `catch`
- a cache write on a path that did not confirm success
- `|| default` / `?? fallback` where the fallback is *remembered*, not just used
- "if we can't tell, assume X" — assuming is fine; **recording** the assumption
  as fact is the bug
