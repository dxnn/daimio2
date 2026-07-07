# gen3 — working file
predecessor: gen2.md (HEAD listed at its end)
opened: 2026-07-07

Inherits the gen2 HEAD: five standing threads (deferred), four spec
drafts awaiting merge (blockeval, depth, sender+qnames, scheduler —
each with a REALIZE list), and the open task queue (bh-render,
hoc-ripples remainder, depth-portable-test, ~52 pending assertion IDs
for the test phase).

Immediate queue:
1. User reviews/merges the four drafts (order matters: scheduler
   depends on sender/QNames [procid-sequence, I16]; depth composes
   with blockeval [blockeval-demand]).
2. Test-suite upgrade phase: labelled tests for merged assertion IDs.
3. #idea:bh-render — renderer/parser/fixture work for black holes.

## Review: scheduler-spec-draft-v2.md (reviewer revisions, 2026-07-07)

Context verified: §8 is now drain/smash ([socket-drain]/[socket-smash],
line 2611+; [socket-overlap-drain] gone); sender/QNames patch MERGED
(ProcessId at line 911); I13 (line 431) states the old unconditional
queue-priority rule; I5 = Serial exclusion (line 385).

Verdicts:
- B1 (drain/smash rewrite of Edit 9): ACCEPT direction; TWO FIXES —
  (i) "new arrivals ... numbered at its entry frontier
  [sched-entry-frontier]" is wrong: buffered arrivals are INTERNAL
  ships that already carry numbers; a socket is not a runtime
  boundary. Fix: buffer carrying numbers unchanged [sched-hop-free],
  release into new content in key order; docking re-numbers via
  [sched-dock-max] (fresh counter is safe — max() lifts). Drop/make
  precise "take over at the number the drain completes on".
  (ii) the edit must ALSO amend [socket-drain]'s own text (line 2620
  "one at a time in FIFO order" → key order per §5), else the spec
  contradicts itself.
- B2 (ordering key drops procid): ACCEPT the call, REJECT the stated
  premise. Merged spec: process ids are OBSERVABLE identity (line
  4278 "names or process ids -- never runtime handles"; [procid-
  sequence] in Identifiers). Reviewer conflated ProcessId with
  [id-internal-handles]'s "processes" (internal pids) — ambiguity in
  the sender patch's own wording; suggest clarifying "(counters,
  pointers)" → "internal process handles, as distinct from process
  ids [procid-sequence]". Correct justification for the call: (1) the
  reviewer's own note is the load-bearing part — per-queue totality
  suffices; the global key was never load-bearing (Lemma 3
  commutation); (2) the ordering key should be static (wire order
  precedes execution; procid is an OUTPUT of the schedule — using it
  as input is near-circular); (3) clean ordering/identity separation.
  GAP flagged: wire-less deliveries (§12 error ships go "directly" to
  @out:err, no input wiring) have undefined wire-position — reserve a
  deterministic position for runtime-direct deliveries.
- B3 (I13 amended + the "+1" fix): ACCEPT both. v1 genuinely missed
  I13 (invariant list and §5 must move together — established
  practice) and v1 Edit 4's "+1" double-counted (emissions carry the
  process's dock number, already max+1). Both were my errors.
- B4 (I17 scoped to reference execution, Option 2): ACCEPT as STAGED
  α — honest about the deferred confluence proof. Note: the middle
  sentence ([sched-advance], unscoped) preserves α's machine-free
  soul inside Option 2. Wording fix: "satisfies this ... an
  equivalence proven in the formalization pass — treat it as a
  conjecture" is self-contradictory; use "is designed to satisfy ...;
  equivalence is a conjecture pending the formalization pass."
  INTENT REGISTERED: when formalization lands, strengthen I17 back to
  the machine-free equivalence (full α).
- S1 (ship tuple) ✓; S2 (bork called out as load-bearing lookahead —
  our O2 insight) ✓; S3 (promises are scheduler substrate, invisible
  to DAML, I8 untouched — matches the ledger's minimal-leak note) ✓.
- S4 (two concurrency axes) ✓ FULLY ALIGNED — this codifies the
  distinction drawn at the session's opening (inter-space determinism
  now vs intra-space segment concurrency as the aspirational future),
  I5 citation correct, Edit-10 inheritance = the axis-2 insight
  (determinism from queue discipline, not serialization). NOTE: our
  ledger's "Axis 1/2/3" (sched-axes) is a different, design-space
  decomposition — S4's two axes are the ones that belong in spec
  prose; no conflict, don't conflate.
