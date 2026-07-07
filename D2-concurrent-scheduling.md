# Concurrent Scheduling: Aspirational Model

This document describes a future extension to the Daimio scheduling
model that would allow multiple ships to execute concurrently within
a single space. This is NOT the current behavior. The current model
is fully serialized per space (see §9 of D2-spec.md).

The deterministic scheduler (D2-spec.md §5, "Deterministic
scheduling") is designed to carry over: determinism derives from queue
discipline (key order), not from serialization, so the
segment-interleaving model below inherits [sched-advance] and
[sched-deterministic] with keys at segment granularity.

## Motivation

The current one-ship-at-a-time model is simple and safe but limits
throughput. If a ship suspends at an async boundary (waiting for
an effectful command's response), the entire space is blocked — no
other ships can execute, even if they would touch completely
different state.

A concurrent model would allow other ships to execute during the
suspended ship's wait, increasing throughput at the cost of
introducing concurrency hazards on shared space variables.

## The concurrent model

In this model, the scheduler maintains a queue of **ready segments**
rather than a queue of whole pipeline executions. A segment becomes
ready when:
  - A ship arrives at a station's in-port (new pipeline)
  - A response arrives at a down-port for a suspended ship (resumption)
  - A timeout fires for a suspended ship (timeout resumption)

### Scheduling rule

```
TICK(queue, σ) where queue = seg :: rest
  = case execute(seg, σ) of

    (ship', σ', EffCmd) →
      (rest, σ', suspended ∪ {SUSPEND(ship', continuation)})
      — request sent out appropriate port; ship awaits response

    (ship', σ', Complete) →
      (rest ++ newSegs, σ')
      where newSegs = segments enqueued by routing ship'.v via wiring
```

### Interleaving properties

Because segments are atomic and the scheduler processes one per tick:

Two ships in the same Daimio instance may interleave at segment
boundaries, but never within a segment.

The key constraint: a **synchronous segment** executes atomically.
No other ship may read or write σ during a segment's execution.
This gives each segment a consistent view of space variables.

### The TOCTOU hazard

If a ship reads $foo, goes async, and writes $foo after resumption,
another ship may have modified $foo in between. This is the one
concurrency hazard in the model. It arises only from ship
interleaving across async boundaries.

This hazard is analogous to a TOCTOU (time-of-check-to-time-of-use)
race. Potential mitigations (not in the base model, possibly layered):
  - Per-ship snapshots of σ (MVCC-style, adds complexity)
  - Compare-and-swap on space variables (adds a new primitive)
  - Advisory locking (adds blocking, which we want to avoid)
  - Documentation and convention (the Daimio2 way, for now)

### Fresh reads under concurrency

Space variable reads always see the current value at the moment of
execution, never a stale snapshot. If a ship suspends at an async
boundary and another ship modifies a space variable, the first ship
sees the updated value when it resumes. This is the "fresh reads"
rule, and under the concurrent model it has real bite — the value
may genuinely differ from what was seen before suspension.

Pipeline variables are the mechanism for preserving values across
async boundaries. Mental model: pipeline vars are mine, space vars
are ours.

### Enabling concurrency

This could be a per-space setting. A space definition would include
a concurrency flag:

```
space = (stations, subspaces, ports, wiringRules, defaultTimeout?, concurrent?)
```

When `concurrent` is false (the default), the space uses the current
serialized model. When true, the space uses the segment-interleaving
model described here.

This lets space authors opt into concurrency where throughput matters
and they've designed their pipelines to handle it, while keeping the
simple serialized model as the default.

### Impact on the "program" characterization

Under the concurrent model, a program that reads and writes space
variables shared with other concurrently-executing ships is no longer
well-characterized as a free monad over effects composed with a state
monad. The state transitions become nondeterministic from the ship's
perspective — another ship may modify σ between any two of your
segments.

The more accurate characterization under concurrency is: cooperative
concurrency over shared state, with atomic transactions at segment
granularity. Each segment is a transaction that reads and writes σ
atomically. Between transactions (at async boundaries), other
transactions can interleave.

The free monad part (effect abstraction and interpretation via
wiring) is unaffected by concurrency. Only the state component
changes character — from a deterministic state monad to
nondeterministic shared state.

### What stays the same

These properties hold in both the serial and concurrent models:
  - Segment atomicity (no interleaving within a segment)
  - Totality (every command returns a value)
  - Copy semantics (values are functionally pure at command boundaries)
  - Dialect confinement (no privilege escalation)
  - Space isolation (cross-boundary access only through ports)
  - Effect locality (effects propagate outward through ports)
  - Single-response effects (down ports return exactly one value)
  - Liveness (timeouts guarantee no ship suspends forever)
  - Timeout compositionality (outer timeouts are authoritative)
  - Block scope isolation (pipeline vars flow in, never out)
