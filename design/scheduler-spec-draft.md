# Deterministic Scheduler (vtime) — draft edits for D2-spec.md

Drafted 2026-07-07 from design/gen2.md (scheduler treatment, ratified
formulation α) and design/sched-determinism-sketch.md. Ten edits,
ordered by spec position. New assertion IDs use the `sched-` prefix
(13 total).

**DEPENDENCY: assumes the sender/QNames patch
(design/sender-spec-draft.md) is merged first** — ship keys use
process ids [procid-sequence] and the determinism claims extend I16.
Composes with the blockeval and depth drafts but does not require
them.

The postcard (normative content in six sentences): Ships carry
numbers. External arrivals are numbered at their entry boundary's
frontier; everything else inherits. Wires preserve order and never
change numbers. Docking is where numbers grow: a station docks a ship
at max(ship number, space counter) + 1 and raises the counter.
Queues dock lowest-first, ties broken by the carrying wire's
declaration order. Nothing docks number k while a lower-numbered ship
can still reach it.

---

## Edit 1 — §1 amendments (P-serial ~110, P-handlersub ~274,
P-portable ~292, invariants list)

**P-serial** — append:

> Serial execution is per-space; ACROSS spaces, execution order is
> governed by deterministic scheduling (§5): sibling spaces may
> interleave or run concurrently, but every observable ordering is
> fixed by ship numbers, not by host timing.

**P-handlersub** — replace "Given the same effect responses, initial
space state, and PRNG seed":

> Given the same input schedule (external arrivals and effect
> responses, with their numbers), initial space state, and PRNG seed

**P-portable** — append:

> The "execution inputs" of deterministic identity (I16) are now
> formal: the input schedule (§5, "Deterministic scheduling"). Two
> runs with the same topology, state, seed, and schedule are
> byte-identical throughout.

**New invariant I17** (append to the invariants list):

> **I17. Scheduling determinism.** Every queue processes ships in
> ascending key order [sched-advance]. Observable behavior equals an
> execution in which each space docks its pending ships lowest-key
> first and no ship docks while a lower-keyed ship could still
> arrive. Given (topology, initial state, PRNG seed, input schedule),
> the observable trace is unique [sched-deterministic].

---

## Edit 2 — §4 Ships (~line 960): the number

Add after the ship definition:

> Every ship carries a **number** (virtual time) in its carrier,
> alongside the sender [sched-ship-vtime]. Numbers are set at entry
> boundaries and at docks (§5); wires and boundary crossings never
> change them. Like the sender, the number is carrier metadata, not
> payload.

---

## Edit 3 — §3 Borks: well-foundedness

Add to the bork list:

>   - A wiring cycle containing no station [sched-cycle-station]
>     (every routing loop must pass through a dock; see §5,
>     "Deterministic scheduling")

---

## Edit 4 — §5: replace "The queue" body's ordering claims and the
sibling sentence (lines 1564–1612)

Amend line 1572 ("Sibling subspaces are independent -- each is its
own space with its own queue, and they can process ships
concurrently."):

> Sibling subspaces are independent -- each is its own space with its
> own queue. They may process ships concurrently; the scheduling
> rules below fix every ordering that is observable, so concurrency
> never introduces nondeterminism (I17).

Amend [queue-fifo]: the queue is ordered by ship number, not arrival:

> ... it either docks immediately (creating a process) or is placed
> in the space's queue, which is ordered by ship number
> [sched-dock-lowest]; among equal numbers, by the declaration order
> of the carrying wire in the space definition [sched-tie-wire]; and
> within one wire, in emission order (wires are FIFO channels
> [sched-wire-fifo], inheriting per-process order
> [routing-deferred-order]).

Amend [queue-priority-routing] (derived, no longer primitive):

> Queued-before-newly-routed [queue-priority-routing] is preserved as
> a consequence: a completing process's routed ships carry its dock
> number + 1, which exceeds the number of anything that entered the
> queue from its own causal past. Ships from other sources order by
> number, not arrival.

---

## Edit 5 — §5: new subsection "### Deterministic scheduling"
(insert after "The queue", before "Process lifecycle", ~line 1613)

> ### Deterministic scheduling
>
> **Numbers.** Every ship carries a number [sched-ship-vtime]. A ship
> entering from outside the runtime — an outermost in-port arrival, a
> black hole emission, an App-provided down-port response, a timeout
> firing — is numbered at its entry boundary's **frontier**: the
> highest number processed anywhere in that boundary's subtree
> [sched-entry-frontier]. The sequence of externally-entering ships
> with their numbers is the **input schedule**; it is the complete
> external input of an execution [sched-input-schedule]. Frontier
> numbering keeps the schedule monotone by construction: no external
> ship is ever numbered below work already processed downstream.
>
> **Docking.** When a ship docks at a station, the process's number
> becomes max(space counter, ship number) + 1, and the space counter
> rises to it [sched-dock-max]. The space counter is the highest
> number the space has issued. Every emission of the process carries
> the process's number. Re-entry is uniform: a down-port response
> docking into its held station applies the same rule, with the
> response's number as the incoming number [sched-reentry-uniform] —
> external responses are numbered by the schedule, internal responses
> carry their handler chain's number.
>
> **Order.** Each space docks its lowest-numbered pending ship next
> [sched-dock-lowest]. Ties resolve by the declaration order of the
> carrying wire in the space's source [sched-tie-wire]; wires are
> FIFO [sched-wire-fifo]. Ships already carrying a number keep it
> across all boundary crossings — subspace entry and exit are free
> hops [sched-hop-free].
>
> **Advance.** No ship docks at number k while a lower-numbered ship
> can still arrive at the same space [sched-advance]. This is an
> as-if rule: implementations may execute in any order whose
> observable behavior matches. Independent equal-number work
> commutes; only convergence points constrain execution.
>
> **Progress.** Every wiring cycle passes through a station
> [sched-cycle-station], so every routing loop advances numbers;
> with the recursion depth bound and down-port timeouts, work at any
> single number is finite and numbers always advance — the advance
> rule cannot deadlock or livelock.
>
> **Determinism.** Given (topology, initial state, PRNG seed, input
> schedule), the observable trace is unique [sched-deterministic]
> (I17). Sketch: process steps are deterministic; keys (number,
> process id [procid-sequence], emission ordinal) are unique and
> total; independent equal-key steps commute; no rule ever creates a
> key below one already processed.
>
> > **Reference implementation.** One priority loop per outer space:
> > all pending docks in a single queue, popped in key order.
> > External arrivals are stamped with the key of the last popped
> > item. Everything above follows.
> >
> > **Local scheduling (informative).** The advance rule can be
> > enforced compositionally, without a universal loop: each space
> > docks its lowest ship only when it clears every boundary
> > promise. Three monotone numbers cross each boundary: the child's
> > promise up ("I will never emit below N"), the parent's floor
> > down ("nothing below N will arrive at your ports"), and the
> > frontier up ("my subtree has processed up to N", used for entry
> > numbering). Idle boundaries advance promises by structure (queue
> > minima plus one per station on each path), never by fiat — an
> > idle boundary must not promise more than its next arrival's
> > number can honor. Progress is guaranteed by [sched-cycle-station]
> > (positive lookahead on every cycle); implementations avoid
> > promise-advancement churn by computing the idle-region fixpoint
> > directly. This is the conforming distributed implementation; it
> > and the reference loop are observationally identical.

---

## Edit 6 — §5 "Port routing and deferred entry" (~line 1672)

Append:

> Deferred entry is subsumed by numbering: routed ships carry their
> process's number, enter target queues through their wires, and
> dock in key order. "Deferred" describes the mechanism (no inline
> execution, [routing-no-process] unchanged); the *order* is fixed
> by numbers, not by deferral timing.

---

## Edit 7 — §7 Async boundaries (~line 2161): resumption numbering

Add after the Resumption rule:

> The response docks into the held station under the uniform entry
> rule [sched-reentry-uniform]: the process's number becomes
> max(space counter, response number) + 1. A process's number can
> therefore jump forward across an async boundary; its space's
> counter follows. Waiting holds the space [serial-wait-holds], never
> the clock — the rest of the tree continues, and queued ships that
> dock after the wait re-number via [sched-dock-max].

---

## Edit 8 — §7.2 Timeouts (~line 2202): the clock as input

Add:

> A timeout firing is an external event: a clock ship numbered at its
> boundary frontier and entered into the input schedule
> [sched-timeout-event]. Whether a response or its timeout arrives
> first is decided by their positions in the schedule — deterministic
> given the schedule; in production the wall clock constructs it, in
> tests it is placed explicitly. Ghost handling [timeout-ghost-drop]
> is then deterministic.

---

## Edit 9 — §8 Socket overlap (~line 2323)

Add after [socket-overlap-drain]:

> Overlap interleaving is deterministic: the old and new subspace are
> two spaces with their own queues, counters, and keys; the drain
> order and all convergences follow the scheduling rules of §5
> [sched-overlap-keys]. No ordering during a transition depends on
> host timing.

---

## Edit 10 — D2-concurrent-scheduling.md (companion doc, one note)

Add to its preamble:

> The deterministic scheduler (D2-spec.md §5) is designed to carry
> over: determinism derives from queue discipline (key order), not
> from serialization, so the segment-interleaving model inherits
> [sched-advance] and [sched-deterministic] with keys at segment
> granularity.

---

## New assertion IDs (13)

sched-ship-vtime, sched-entry-frontier, sched-input-schedule,
sched-dock-max, sched-reentry-uniform, sched-dock-lowest,
sched-tie-wire, sched-wire-fifo, sched-hop-free, sched-advance,
sched-cycle-station, sched-deterministic, sched-timeout-event
(plus sched-overlap-keys in Edit 9 — 14 with it.)

## Proof-obligation map (from sched-determinism-sketch.md)

O1 schedule monotone → [sched-entry-frontier] (by construction)
O2 cycles pass stations → [sched-cycle-station] (bork, Edit 3)
O3 per-process determinism → existing (P-total, PRNG, depth bound,
   routing-deferred-order, I6)
O4 unique process ids → [procid-sequence] (sender patch — dependency)
O5 key totality → [sched-dock-max] + [sched-tie-wire] +
   [sched-wire-fifo] + [procid-sequence]
O6 key-sorted queues → [sched-dock-lowest]
Weak spot 1 (effective-key mutation) → covered by counter
   monotonicity in [sched-dock-max]; full proof deferred to the
   formalization pass.
Weak spot 2 (frontier under mid-step callbacks) → resolved by
   [sched-entry-frontier] + reference-loop stamping rule ("key of
   last popped item"); local implementations must use max-seen
   frontier.

## Test material

- Convergence order: A and B fan-in to C; outputs arrive A-first by
  wire order, on every run and host [sched-tie-wire] [sched-advance].
- B-then-C unschedulable: with A's dock pending at a lower number, C
  cannot dock B's ship first [sched-advance].
- Self-send fairness: a self-feeding space interleaves fresh external
  arrivals at the frontier, never starves them [sched-entry-frontier]
  [sched-dock-max].
- Held-space re-numbering: ships queued behind a long App wait dock
  with re-raised numbers; no retroactive keys downstream
  [sched-reentry-uniform] [sched-dock-max].
- Replay: identical schedule → byte-identical trace incl. error
  ships [sched-deterministic] [id-deterministic].
- Bork: a station-free wiring cycle fails to compile
  [sched-cycle-station].

## Implementation follow-ups (not spec work)

- Replace the 4 D.setImmediate call sites with the reference priority
  loop; route timers through the schedule (virtual clock injectable
  for tests).
- Thread the number through the ship carrier next to {sender}.
- Audit D.BLOCKS / D.SPACESEEDS / D.Etc for observable cross-space
  state (proof sketch weak spot 3; ties to runtime-isolation).
- Fuzzer: add a replay mode — record schedules, assert byte-identical
  reruns.
