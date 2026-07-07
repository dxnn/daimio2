# Deterministic Scheduler (vtime) — v2 revisions

Revisions to `scheduler-spec-draft.md` resolving the guardian review
(B1–B4 blocking, S1–S4 smaller). Keyed to v1's edit numbers; only the
*changed* text is here — unmentioned v1 edits stand.

**Two design calls (override if you disagree):**
- **B2 — ordering key = `(number, carrying-wire declaration order,
  wire-FIFO position)`.** Drop `procid` from the tiebreak — but NOT
  because it's non-observable (it IS observable: process ids are the
  identity vocabulary, §4 Identifiers / §12 error ships, line 4278).
  The real reasons: (a) per-queue totality suffices — cross-space order
  is the advance rule's job, the global key was never load-bearing; and
  (b) the ordering key must be **static** — wire order is known from
  source before execution, whereas procid is assigned *during* the
  schedule, so keying the schedule on procid is circular. procid stays
  the *identity* key (I16).
- **B4 — I17 scoped to the reference execution** (Option 2); the
  distributed equivalence is a labeled conjecture. This is a *staged*
  version of the ratified machine-free formulation, not a retreat —
  `[sched-advance]` stays unscoped inside the invariant.

**Reviewer round — three corrections applied, all verified against the
merged spec:** (1) B2's justification was factually wrong (procid IS
observable) — reason replaced, call unchanged; (2) B1 misapplied the
entry-frontier rule to internal ships and must also fix the drain
sentence beside it; (3) I17's closing clause asserted-and-retracted in
one breath — reworded. Plus two items the reviewer surfaced: a reserved
key position for wire-less runtime deliveries, and a clarifying edit to
`[id-internal-handles]`.

---

## B1 — Edit 9 rewritten for drain/smash (v1 targeted the removed overlap)

v1's Edit 9 anchors to `[socket-overlap-drain]` and "overlap
interleaving," both deleted when §8 became drain/smash. Two parts.

**(a) Replace Edit 9** with an addition after the drain/smash
paragraphs (§8, after `[socket-smash]`):

> Socket transitions are deterministic. Under **drain**, the old
> content docks its remaining ships in key order `[sched-dock-lowest]`.
> New arrivals — internal ships that already carry numbers — buffer at
> the socket with their numbers **unchanged** `[sched-hop-free]` (a
> socket is Daimio-internal topology, not a runtime boundary, so
> `[sched-entry-frontier]` does not apply); they release into the new
> content in key order and re-number at their docks via the max() rule
> `[sched-dock-max]`, so the fresh content's zero counter is safe.
> Under **smash**, the swap is one scheduled event at its own number:
> ships destroyed by the smash never dock, and a returning down-port
> response becomes a ghost deterministically. No transition ordering
> depends on host timing `[sched-transition-keys]`.

**(b) Amend `[socket-drain]` itself** (§8, line 2620) — it still says
the old content drains "one at a time in FIFO order," which would
contradict the "docks in key order" paragraph now beside it. Change to
"one at a time in key order (§5, "Deterministic scheduling")."

(ID renamed `sched-overlap-keys` → `sched-transition-keys`.)

---

## B2 — one ordering key, used by both the rule and the proof

**Edit 4 / Edit 5 "Order" — normative rule** (replaces the tie-break
sentences):

> Each space docks its lowest-numbered pending ship next
> `[sched-dock-lowest]`. Ties (equal numbers) resolve by the
> declaration order of the carrying wire in the space's source
> `[sched-tie-wire]`, then by FIFO position within that wire
> `[sched-wire-fifo]`. A ship the runtime delivers with no carrying
> wire — an error ship sent directly to `@out:err` (§12) — takes a
> **reserved position after all wired ships** at the same number,
> ordered among themselves by emission order. This key is **total per
> queue**: within one wire ships are a FIFO sequence, distinct wires
> order by source position, and wire-less deliveries sort last, so no
> two pending ships tie.

**Edit 5 "Determinism" sketch** (replaces the parenthetical key):

> Sketch: process steps are deterministic (P-total, PRNG, depth bound,
> `[routing-deferred-order]`, I6); the per-queue key `(number,
> wire-declaration-order-or-reserved, wire-FIFO-position)` is total;
> docking only ever assigns a number ≥ those already processed (counter
> monotonicity, `[sched-dock-max]`); independent equal-number work in
> different spaces commutes. The ordering key is entirely **static**
> (topology-derived); process ids `[procid-sequence]` are the
> *identity* key (I16), never the ordering key, so the schedule never
> keys on a value it assigns during execution.

Note: global uniqueness of numbers is *not* required — numbers are
unique only per space (counter strictly increases), and cross-space
ordering is governed by the advance rule, not a global key. So the key
only needs to be total per queue, which it is.

**Companion clarifying edit (to the merged sender patch, not the
scheduler).** `[id-internal-handles]` (§4, line 949) says handles exist
"for ports, processes, and ships"; "processes" there means the
*internal* pid, not the observable `ProcessId`. Disambiguate — e.g.
"internal process handles, as distinct from process ids
`[procid-sequence]`" — so nothing reads process ids as non-observable.
This is a standalone fix to already-committed text; can land now or
with the scheduler.

**Integration question (flag, not resolved).** The sender patch says
each space keeps a "process sequence" that "takes the next number"
(`[procid-sequence]`, §4 line 940), while the scheduler's space counter
is the vtime `max(counter, ship#)+1` (which jumps, not a simple +1).
Same per-space counter (so a process id is `qname#vtime`) or two? I'd
unify — the vtime *is* the sequence — but pin it during integration,
since `[procid-sequence]` is cited in the determinism obligations.

---

## B3 — I13 amended (it's superseded, not derived) + the "+1" fixed

**Edit 1 — amend I13** (v1 added I17 but left I13 stating the old
unconditional rule, now false):

> **I13. Queue priority.** A space docks its pending ships lowest-key
> first (I17), not by arrival order. A completing process's routed
> ships carry its dock number, which exceeds every number in the
> process's own causal past, so ships causally prior to it still dock
> before its output; ships from independent sources order purely by
> number. (This subsumes the earlier "queued ships dock before newly
> routed ships" heuristic, which holds only for the causally-prior
> case.)

**Edit 4 — fix the increment.** v1 says routed ships "carry its dock
number **+ 1**"; Edit 5 says "every emission carries the process's
number." The process's number *is* the dock number (`max(counter,
ship#)+1`). Use one wording:

> ... a completing process's routed ships carry **the process's dock
> number** (`max(counter, incoming#)+1`), which exceeds the number of
> anything in its causal past. Ships from other sources order by
> number, not arrival.

---

## B4 — I17 scoping options (recommend Option 2)

The reference loop (one priority queue per outer space) is trivially
deterministic. The **distributed** "Local scheduling" variant
(promises/floors/frontiers) is claimed observationally identical, but
the proof is deferred (obligation-map weak spots 1 & 2). Options for
how strongly to state I17:

- **Option 1 — I17 asserts full equivalence.** Strongest; requires the
  deferred formalization proof now. Risk: the spec asserts more than is
  proven, on a determinism invariant.
- **Option 2 — I17 scoped to the reference execution (RECOMMENDED).**
  I17 asserts uniqueness of *the reference execution's* trace given
  (topology, state, seed, schedule) — provable now. The distributed
  implementation is a separate **conformance requirement**: "a
  conforming implementation's observable trace equals the reference
  execution's," carrying a labeled note that the equivalence is a
  conjecture pending the formalization pass (conservative-PDES theory
  makes it very likely). Keeps the reference execution as the normative
  anchor and quarantines the open proof.
- **Option 3 — no invariant yet.** State deterministic scheduling as a
  property (P-…), not an invariant, until the proof lands. Weakest;
  loses the crisp I17.

**Recommended I17 (Option 2):**

> **I17. Scheduling determinism.** In the reference execution — one
> priority queue per outer space, docking pending ships lowest-key
> first `[sched-dock-lowest]` — the observable trace is a unique
> function of (topology, initial state, PRNG seed, input schedule)
> `[sched-deterministic]`. No space docks a ship at number k while a
> lower-keyed ship could still reach it `[sched-advance]`. A conforming
> implementation's observable trace equals the reference execution's;
> the distributed "Local scheduling" implementation (§5) is designed to
> satisfy this by conservative lookahead `[sched-cycle-station]` — that
> equivalence is a conjecture pending the formalization pass (companion
> sketch).

---

## S1 — ship carries the number (amend the tuple, don't just narrate)

**Edit 2 — amend the §4 ship definition** rather than only adding prose:

> ```
> ship = (value, sender?, number)
>   where value  : FinalVal   -- the payload
>         sender : Sender?     -- who originated it (§4 Senders)
>         number : Nat         -- virtual time (§5) [sched-ship-vtime]
> ```
> `sender` and `number` are **carrier** metadata — set by the runtime
> at entry boundaries and docks, never by the payload and never by
> DAML.

---

## S2 — call out the new bork

**Edit 3** stands, but flag it as a new constraint where it's
introduced (§5 "Progress"):

> Every wiring cycle must pass through a station `[sched-cycle-station]`
> — a **new well-formedness rule**: a station-free routing loop borks
> (§3). This is load-bearing, not cosmetic: the station's dock is the
> positive lookahead (+1 per cycle) that lets the conservative advance
> rule make progress; without it a routing loop would have zero
> lookahead and the scheduler could stall.

---

## S3 — scheduler signals are substrate, not DAML communication

Add to the "Local scheduling (informative)" note (§5):

> The frontier and promise signals that cross space boundaries are
> scheduler **substrate**: they carry no DAML value and are invisible
> from inside any space. Space boundary opacity (I8) governs
> DAML-level communication — ports — which the scheduler does not use;
> the promises are the runtime coordinating with itself, like the
> queue or the PRNG.

---

## S4 — distinguish the two concurrency axes

Add to §5 "Deterministic scheduling" (and adjust the "Future:
concurrent scheduling" note to point at it):

> Two independent axes of concurrency. **Cross-space** ordering is
> deterministic *now*: sibling spaces may interleave, but ship numbers
> fix every observable ordering (this section). **Within-space**
> execution remains strictly serial (I5) — one ship at a time per
> space; relaxing *that* into segment-level interleaving is the
> separate future direction (`D2-concurrent-scheduling.md`), which
> inherits this section's key discipline (Edit 10).

---

## Net changed IDs
- Renamed: `sched-overlap-keys` → `sched-transition-keys` (B1).
- Dropped from the ordering key: `procid` (B2) — stays for identity.
- I13 amended (B3), I17 reworded (B4), §4 ship tuple amended (S1).
- No other v1 IDs change; the other v1 edits (2 minus the tuple line,
  6, 7, 8, 10) stand as written.

## Still deferred to the formalization pass (unchanged from v1)
- The reference ⇄ distributed equivalence (B4 conjecture).
- Weak spot 1 (effective-key mutation) — counter monotonicity argument.
- Weak spot 2 (frontier under mid-step callbacks) — max-seen rule.
