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

## Reconciliation 2026-07-08 — repo moved past the ledger

Between the v2 review above (07-07 ~11:25) and now, all four drafts
were merged into D2-spec.md and the test phase began. Evidence: git
history (bb294b5 "scheduling" 07-07 22:41 = scheduler merge; 356c36a
07-07 23:09 = post-merge triage) and the assertion-ID families now
present in the spec. Executing the REALIZE-on-merge plan declared in
gen2's HEAD:

REALIZE #idea:hoc-finding, #idea:hoc-uniformeval-anchor,
  #idea:hoc-covering-rule, #idea:hoc-parametric-purity,
  #idea:hoc-derivable-category → [dd:blockeval] — blockeval draft
  merged ([blockeval-demand], [blockeval-category],
  [blockeval-parametric], [blockeval-sync-when-pure],
  [blockeval-no-port], [blockeval-segment] in spec).

REALIZE #idea:depth-finding, #idea:depth-timeout-dual,
  #idea:depth-single-demand-site, #idea:depth-instance-bound →
  [dd:depthbound] — depth draft merged ([depth-bound],
  [depth-bound-instance], [depth-exceeded-sploot],
  [depth-nesting-only], [depth-reset-routing] in spec).

REALIZE #idea:sender-gap-finding, #idea:sender-entry-rule,
  #idea:port-qualified-name, #idea:sender-carrier-not-payload,
  #idea:sender-registry-app-side → [dd:sender-entry] — sender draft
  merged ([sender-attach-entry] ×7, the sender-propagate family,
  [qname-structure], [qname-anon-station] in spec).
REALIZE #idea:qname-all-runtime-ids → [dd:sender-entry] — realized in
  STRENGTHENED form: triage decision 4 (356c36a) dropped procids
  entirely; observable ids are qnames + content hashes,
  [procid-sequence] removed. The one non-qname observable id class is
  gone.

REALIZE #idea:sched-goal, #idea:sched-vtime, #idea:sched-advance-rule,
  #idea:sched-space-ready-time, #idea:sched-promise-protocol,
  #idea:sched-frontier-up, #idea:sched-convergence-only,
  #idea:sched-axes, #idea:sched-input-schedule,
  #idea:sched-proof-sketch, #idea:sched-choke-point,
  #idea:sched-nondet-inventory, #idea:sched-vtime-wellfounded →
  [dd:scheduler] — scheduler v2 merged (bb294b5): [sched-ship-vtime],
  [sched-entry-frontier], [sched-input-schedule], [sched-dock-max],
  [sched-dock-lowest], [sched-advance], [sched-hop-free],
  [sched-reentry-uniform], [sched-timeout-event],
  [sched-transition-keys], [sched-cycle-station],
  [sched-deterministic] in spec.
REALIZE #idea:sched-qname-tiebreak → [dd:scheduler] — realized in
  AMENDED form per verdict B2: the equal-number tiebreak is wire
  declaration order [sched-tie-wire] + FIFO position within the wire
  [sched-wire-fifo], not qname. B2's flagged GAP (wire-less deliveries)
  was CLOSED in the merged text: a ship delivered with no carrying
  wire (§12 error ship direct to @out:err) sorts after all wired ships
  at its number, by emission order.

RESOLVE #tension:sched-socket-overlap — by the drain/smash rewrite
  (verdict B1, both fixes applied): §8 now [socket-drain] /
  [socket-smash]; buffered arrivals keep their numbers
  [sched-hop-free] and re-number on dock via [sched-dock-max];
  [socket-overlap-drain] is gone.
  IMPORTANCE: HIGH — this was the last open tension on the scheduler.
  CONFIDENCE: HIGH — verified in merged spec text, 11 suites green at
  the triage commit.
  RIGOR: CAREFUL — went through draft → adversarial review → v2 →
  verdict fixes → merge.

Six post-merge triage decisions (356c36a, user's calls — commit
message is the authoritative wording), recorded as dds:

[dd:process-sender-read] §13 refined: no command creates, modifies,
  or forges a sender or exposes its dialect, but a process may read
  its own sender id (read-only, unforgeable) via {process sender},
  dialect-gated. §14 drops __sender.id in favor of it.
[dd:qname-source-order] anon-station qnames keep source order (s1,
  s2); [qname-structure] "source topology alone" → "source order
  alone". Layout's rank scheme is non-canonical and unmentioned.
[dd:malformed-cmd-sploot] a command definition with fun+effect, or
  neither, sploots on invocation; §5 effect-partition updated (no new
  verb).
[dd:no-procids] procids dropped from the observable surface:
  observable ids are qnames + content hashes; error ships name
  qnames. ProcessId domain (§4), the §10 "Process ids" paragraph,
  [procid-sequence] removed; I16 / handles / error-ship format / the
  process record trimmed. Ship/dock numbers remain as scheduling
  metadata. Also moots the §14 sub-process attribution question — no
  id left to attribute.
[dd:wires-always-fifo] [queue-fifo] → [space-queue] (number-ordered);
  wires restated as always-FIFO channels, not just a tiebreak.

New tagged item — the B4 verdict's "INTENT REGISTERED" was untagged
and would have been lost at graduation:

[idea:sched-i17-full-alpha] INTENT: when the formalization pass lands,
  strengthen I17 from "reference execution" (staged α, Option 2) back
  to the machine-free equivalence (full α).
DEFER #idea:sched-i17-full-alpha — blocked on the formalization pass.

Test phase: STARTED (this is queue item 2 from the top of this file).
Landed since the review: sender/dialect determinism suite (bf12818);
black-hole / socket-load / cmd-port compile-bork guides (4f5830c);
scheduler/id RED guides + internal-dock trace hook (a1eede7);
[sched-dock-max] dock-number guide (1d4d5b5); world-I/O determinism
suite — emission green, round-trip RED (49d55ec); overridable D.now
clock + time/virtual-time determinism harness (930be28, 7529e4d).
TODO.md carries the dependency-organized RED-guide backlog (009442f).

NOTE (claude): TODO.md's backlog line "Deterministic scheduler — ...
deferred until this exists (spec #11); ask before speccing" is stale —
the speccing happened. Worth trimming next time TODO.md is touched.

NOTE (claude): #idea:bh-render (queue item 3) remains untouched — the
black-hole test guides in 4f5830c are compile-bork guides, not the
renderer/parser/fixture work.

## Opening #idea:bh-render (2026-07-08)

> "Testing is being handled in another thread, we're focused on the
> uncharted design space here. Let's open bh-render"

Scope split: labelled tests for the blackhole-* assertion IDs move to
the test thread; this thread carries the design of the picture.

Ground truth: no `((name))` handling exists anywhere —
seedlikes_from_string, extract, layout, both renderers, and the ASCII
parser are all black-hole-blind. Baseline render form (subspace-multi
fixture): a referenced subspace is a flat box, name inside
(`| inner |`), bare `o` ports on the walls; every space definition in
the file gets its own standalone picture.

OBSERVATION (claude): of the 17 blackhole-* assertion IDs, only a
small subset reaches the picture at all. Flavour mirroring
[blackhole-flavour-oppose] and default-flavour [blackhole-default-
flavour] are invisible — labels and flavours are never rendered, and
round-trip canonicalization (bare @in/@out re-acquire defaults on
re-parse) already composes correctly with the mirrored defaults.
Sender, correlation, opacity, crossing are pure semantics (test
thread). Picture-relevant: [spacesyn-blackhole] (the (( )) form),
[blackhole-ref-bare] (endpoints use bare name), [blackhole-only-ports]
/ [blackhole-no-interior] (nothing to draw inside),
[blackhole-inout-only] (a hole box never grows ^v vertical-port
glyphs), [blackhole-not-root] (a hole is never the outer picture;
parser emission order must never leave a hole as last-defined root
[spacesyn-outer-root]).

Decomposition, tagged:

[idea:bh-box-marker] DD-CANDIDATE: the rendered marker distinguishing
  a black-hole box from an ordinary subspace box in ASCII. Leading
  candidate: echo the source form — label renders as `((relay))`
  inside the box walls where `inner` renders today. Constraints:
  ASCII-safe; unambiguous to the parser at grid level (stations
  already use `( )` — but the label sits inside box borders, so no
  collision); all seven invariants; exact round-trip.

[idea:bh-svg-dark] the SVG marker: render the hole's box filled
  dark — literally a black hole. Free in SVG, evocative, zero
  grid-ambiguity concerns. Sub-question: label legibility on fill.

[tension:bh-standalone-render] #idea:bh-box-marker vs
  [blackhole-no-interior]: every space definition currently renders
  its own standalone picture, but a hole has no inside. Render an
  empty ported box (uniform, machinery exists — portonly fixture) or
  skip the standalone picture (honest about no-interior, but breaks
  one-picture-per-definition and the parser must mint the `((name))`
  definition purely from its appearance in the parent's picture)?

[idea:bh-parse-emit] TASK: space_ascii_parse.js recognizes the marker
  and emits a `((name))` definition with canonical bare ports, before
  the referencing space [spacesyn-subspace-before-ref], never as the
  trailing/root space.

[idea:bh-pipeline-flag] TASK: seedlikes_from_string parses `((name))`
  → blackhole flag on the seedlike → extract carries it → layout
  treats the box as a subspace with no vertical-port machinery.
  Compile borks (only-ports, flavour-oppose, inout-only, not-root)
  already have RED guides in the test thread (4f5830c).

[idea:bh-fixtures] TASK: new fixture dirs (hole wired in a parent;
  hole + ordinary subspace side by side; multi-port hole). New
  fixtures only — no regeneration of existing ones without asking
  (standing feedback).

[idea:bh-editor-surface] QUESTION: editor-side surface — CodeMirror
  spacesyn mode/hint for `((`, and whether spaceeditor's auto-DOM
  generation should read a hole's mirrored dom-* flavours (a
  `((widget)) @out:clicks dom-on-click` is a legitimate DOM-as-world
  hole). Candidate DEFER — demo territory, not blocking the picture.
