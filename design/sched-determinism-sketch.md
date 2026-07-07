# Determinism of the vtime scheduler — proof sketch

Design artifact, 2026-07-06. High-level but structured; obligations and
weak spots named explicitly. Companion to the scheduler rounds in
gen2.md.

## Setup

Fix:
- T — the compiled topology: the tree of spaces, stations, ports,
  wires, wiring rules (finite).
- σ₀ — initial state stores; PRNG seed per the existing per-space rule.
- E — the external input schedule: a sequence of stamped external
  events e₁, e₂, … Each is (entry point, payload, stamp) where entry
  point is a boundary port (outermost in-port, black hole out-port),
  an App-side down-port response, or a clock event (timeout firing).
  REQUIRED property (O1): stamps are non-decreasing along E, and each
  stamp is ≥ the frontier at its insertion. In production, E is
  *constructed* by frontier-stamping arrivals, so O1 holds by
  construction; for replay, E is given and O1 is a validity condition.

Configuration C = per space s: (σ_s, Q_s, f_s, W_s) — state store,
queue of stamped ships tagged with arrival wire, next-free time,
optional waiting-process record — plus the pending-event list L.

Events: DOCK(s, station, ship) and RESUME(s, response). Ships and
events carry keys.

**Key construction.** A ship emitted by process p as its i-th emission
has key k = (vtime, pid(p), i), where vtime = docktime(p) + 1 and
pid(p) = (space qname, per-space process sequence number)
[procid-sequence]. External events are keyed by (stamp, schedule
position). A DOCK's *effective key* is (max(ship.vtime, f_s), tiebreak)
— see Weak Spot 1.

**Canonical execution**: repeatedly pop the least-key *eligible* event
(eligible: its space is not held), execute atomically, insert whatever
it produces.

## Claim

Any two executions conforming to (R1) per-wire FIFO, (R2) fan-in merge
by key, (R3) the advance rule (an event executes only when no
smaller-keyed event can still arrive at its queue) produce identical
observable traces: the same sequence of (payload, sender, stamp) at
every outermost out-port, every black hole in-port crossing, and
@out:err — and identical final configurations for finite E.

## Lemma 1 — Process determinism (the station step)

A process step is a pure function:
  step : (block, __in, sender, σ_s, rng_s) →
         (σ_s′, rng_s′, ordered emissions, outcome)
where outcome ∈ {complete, WAIT(port, continuation)}.

Grounds (all existing spec): totality of commands [P-total, I1];
per-space PRNG determinism [random-pure]; exclusive state access
during the process [I6, serial-wait-holds]; deterministic emission
order [routing-deferred-order]; sub-processes synchronous depth-first
[subprocess-sync-dfs] at the same vtime; block-eval covered by the
blockeval rules; termination of the pure part by the depth bound
[depth-exceeded-sploot] + finite segments + finite values.

Note: rng_s consumption order equals process execution order in s,
which is queue order — deterministic by the main induction. PRNG
determinism is therefore *conditional on* scheduler determinism, not
independent of it; the induction below carries both.

## Lemma 2 — Key uniqueness and totality

Every ship and event has a key, keys are totally ordered, and no two
distinct ships share a key.

Uniqueness: (vtime, pid, ordinal) — pid unique by qname uniqueness
(existing borks) × per-space sequence; ordinals unique within a
process [routing-deferred-order]; external keys unique by schedule
position. Totality: lexicographic order on well-ordered components.
Determinism of the key itself: by induction — a ship's key is computed
from its emitter's dock time and sequence number, which are determined
by the prior trajectory.

## Lemma 3 — Commutation of independent steps (confluence)

Two eligible events at distinct spaces with equal least keys commute:
executing them in either order yields the same configuration.

Proof idea: each step touches only its own space's (σ, Q, f, rng) —
disjoint — plus insertions into target queues. Insertions carry
intrinsic keys (Lemma 2) computed from the emitting chain, not from
execution order; queues are key-sorted structures, so a queue's state
is the *set* of its ships — insertion order invisible (O6). Hence both
orders produce identical configurations. By Newman-style induction on
vtime prefixes, any conforming execution (one that respects R1–R3 but
pops independent equal-key events in any order, or in parallel) is
confluent with the canonical one.

This lemma is where machine-independence cashes out: implementations
may deviate from canonical pop order exactly where this lemma applies.

## Lemma 4 — Monotonicity (no retroactive keys)

Once the canonical execution pops key k, no event with key < k is ever
inserted afterward.

Proof idea: every insertion rule is strictly future-directed —
emissions stamp docktime+1 > docktime; docks re-stamp at
max(ship.vtime, f_s) ≥ ship.vtime; f_s only increases (completion
times are ≥ dock times); resumption emissions stamp from the response
key (≥ frontier by O1 for external; by induction for internal);
external insertions respect O1. Same-vtime cascades (free port hops)
are finite by O2 (every wiring cycle passes a station). Hence the
frontier is non-decreasing and the advance rule is implementable:
"no smaller key can still arrive" holds exactly when all pending keys
≥ k, which the priority-queue loop enforces syntactically.

## Main theorem — induction on key order

By strong induction on keys: the configuration after processing all
events with key ≤ k is a deterministic function of (T, σ₀, seed,
E↾≤k).

Base: C₀ from T and σ₀. Step: given determinism up to the previous
key, the pending set is determined; the least eligible key is
determined (Lemma 2 totality; eligibility determined by W/f state);
its execution is deterministic (Lemma 1); its insertions carry
determined keys (Lemma 2); no smaller key appears later (Lemma 4);
equal-key independent pops don't matter (Lemma 3). The observable
trace is a projection of the trajectory, hence determined. ∎ (sketch)

## Coverage checklist

- Ships: keyed, per-wire FIFO (R1), merged by key (R2).
- Spaces: serial [serial-one-at-a-time], held during WAIT
  [serial-wait-holds], next-free scalar f_s (job-shop re-stamping).
- Stations: Lemma 1. Sub-processes: inside Lemma 1, same vtime.
- The outside: all external influence is E — boundary in-ports, black
  hole emissions, App responses, clock events. Timeouts race responses
  *within E*: given E, the winner is determined; ghost handling
  [timeout-ghost-drop] is then deterministic.
- Internal responses (up-port wiring to a sibling handler): ordinary
  stamped ships — inside the induction, NOT part of E. This is the
  internal/external line, now formal: E contains exactly what crosses
  a runtime boundary inward.
- Senders/dialects: entry rule + registry are deterministic functions
  of port identity [sender-attach-entry]; effective dialect at dock
  determined.
- Error ships: emissions of the erring process — keyed like any ship.
- Socket overlap: old and new subspace are two spaces with their own
  queues and f values; drain order falls out of keys. (Verify against
  [socket-overlap-drain] semantics when drafting.)

## Obligations (each must become a spec assertion or a validity rule)

- O1 input schedule monotone, ≥ frontier at insertion.
- O2 no station-free wiring cycles (same-vtime finiteness)
  [sched-vtime-wellfounded].
- O3 per-process determinism (existing: P-total, PRNG, depth bound,
  routing-deferred-order, I6).
- O4 unique deterministic process ids [procid-sequence] — the QNames
  patch is load-bearing for the proof.
- O5 key totality (construction above).
- O6 queues are key-sorted; insertion order invisible.

## Weak spots (named honestly)

1. EFFECTIVE-KEY UPDATES. A queued DOCK's pop key is
   max(ship.vtime, f_s), and f_s changes when the space completes —
   so keys in the pending list are mutable (priority updates). The
   proof needs f_s-monotonicity (it only increases) so keys only
   increase — consistent with Lemma 4 — but the formal statement of
   the advance rule must be over effective keys, and the pending-list
   invariant ("all future keys ≥ popped keys") must be re-proved with
   mutation. I believe it holds; it is the most delicate spot.
2. FRONTIER DEFINITION for production stamping: "key of the last
   popped event" — must be stated carefully so that O1 is guaranteed
   by construction even when the host delivers callbacks mid-step
   (arrivals during a step are stamped after it).
3. Lemma 3's disjointness assumes no shared mutable state between
   spaces — true by I8, but global registries (D.BLOCKS, D.SPACESEEDS,
   D.Etc) must not carry observable cross-space state. Known thread:
   runtime-isolation. An implementation audit item, not a model flaw.
