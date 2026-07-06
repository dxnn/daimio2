# gen2 — working file
predecessor: gen1.md (HEAD listed at its end)
opened: 2026-07-05

## Higher-order commands vs the effect partition (2026-07-05)

Reviewer finding, received via user:

> "The effect partition doesn't hold for higher-order commands, and no
> transition rule covers them (AR-6). list map et al. have a fun yet need
> the environment and can suspend on inner effects; the PureCmd rule is
> synchronous and can't model them. The partition needs a third,
> explicitly-defined category (block-evaluating commands) or a reframing
> of "pure" as "effect-free modulo sub-process evaluation," plus a
> covering rule."

User framing:

> "P-uniformeval speaks to this directly: `list map` creates a
> sub-process. I agree that we need to be explicit about this. Let's
> explore the tradeoff space around this."

(AR-6 is the reviewer's own numbering; it maps to the transition-rule
coverage gap in §7/§11 — PureCmd at line 3336 is strictly synchronous
`v' = fun(args')`; EffCmd only models port requests.)

[idea:hoc-finding] OBSERVATION: block-evaluating commands (list map et
  al.) have a `fun` — so P-effectpartition classifies them pure — but
  they need the environment (dialect, scheduler) to evaluate their block
  params and can suspend when an inner block hits an effect. Two spec
  claims break: "never both, never neither" + "can be executed with no
  environment at all" [P-effectpartition, line 243], and no transition
  rule covers them (PureCmd is synchronous; EffCmd is port-only).

[idea:hoc-uniformeval-anchor] OBSERVATION: the spec already ADMITS the
  behavior — P-uniformeval (line 224): "a block passed to `list map` --
  both create a sub-process." The behavior is specified; the taxonomy
  and rules just don't model it. This is a partition/rules gap, not a
  semantics gap.

[tension:hoc-partition] #idea:hoc-finding vs [P-effectpartition]:
  the binary partition is load-bearing (effect skeleton decomposition,
  P-handlersub, registration-time checkability, the free-monad aside)
  yet the third behavior exists in the wild. Must be made explicit.

[tension:hoc-taxonomy] resolution shape for #tension:hoc-partition:
  name the category vs weaken "pure". Options on the table:
  A: explicit third category (block-evaluating commands) + covering rule
  B: "pure" redefined as effect-free-modulo-sub-process + covering rule;
     category stays anonymous
  D: reclassify block-evaluating commands as effectful — rejected
     candidate (pure mapping would create async boundaries and pollute
     the effect surface; a map of a pure block IS pure computation)
  E: model block evaluation as an internal effect/demand handled by the
     runtime itself (never crosses the boundary, invisible on the
     effect surface); fun stays a total function returning
     Value | Demand(block, input, k)

[idea:hoc-covering-rule] OBSERVATION: every option A/B/E needs the SAME
  covering transition rule — the choice is taxonomy, not semantics.
  Rule shape (HOCmd, modeled on EffCmd): spawn sub-process per block
  application (synchronous, depth-first per current model); if the
  sub-process completes synchronously the step behaves like PureCmd;
  if it suspends on an inner effect, the parent WAITs on the
  sub-process rather than on a port. This is also where the
  implementation's NaN-async signal finally gets formalized (currently
  documented only in CLAUDE.md internals).

[idea:hoc-parametric-purity] PROP: a block-evaluating command is
  exactly as pure as the blocks it is given — purity is parametric.
  The effect skeleton becomes recursive: skeleton(pipeline) splices in
  the skeletons of sub-processes. Decomposability and P-handlersub
  survive compositionally under this statement. Candidate spec prose
  regardless of which taxonomy option wins.

[idea:hoc-derivable-category] OBSERVATION: the category is almost
  signature-derivable: fun ∧ ≥1 block-typed param. Builtin members:
  list map/reduce/each/merge/filter/first/index (+ sort via its by/block
  machinery), process run. Counterexample: daggr add_type/set_template
  (local/, stub fun, stores the block as data). The spec could mandate
  "block-typed params are evaluation positions; blocks-as-data travel
  as strings until revived" — consistent with the existing dead-string/
  unquote story (§4 Programs, P-uniformeval) — making the three-way
  registration check fully mechanical and ruling daggr's usage
  noncompliant-legacy (it's local/, not builtin).

[idea:hoc-ripples] TASK: consistency sweep needed whichever option
  wins — P-total wording, [total-cmd-value], P-handlersub "follows
  from" derivation, the free-monad aside (sub-trees spliced at
  higher-order nodes), §11 segment grammar (seg ::= PureCmd | ...),
  dialect-check note (line 3941), optimizer note (OPT_simple_math /
  OPT_simple_peek purity assumptions), and the known-failure family
  "time.now has fun fallback" (same partition-hygiene family, already
  tracked as a d2_spec_test known failure).

## Decisions round 5 (2026-07-05)

RESOLVE #tension:hoc-taxonomy — option A+E
RESOLVE #tension:hoc-partition — via the A+E patch (draft pending merge)
  > "Yes, I agree, write up A+E -- but note that a dead block is really
  > just a string, and doesn't need to be mentioned. And block params
  > can't unquote the block they receive. So that part is really just
  > "commands with block-typed params are as effectful as the blocks
  > they receive". No need to mention daggr etc."
  IMPORTANCE: HIGH — repairs a load-bearing property (P-effectpartition)
    and closes the transition-rule coverage gap.
  CONFIDENCE: HIGH.
  RIGOR: CAREFUL — full option space explored (A/B/D/E), B rejected for
    anonymous-category regress, D rejected on semantics, E's machinery
    declined but its insight kept as the algebraic aside.
  NOTE (claude): user's simplification sharpens
    #idea:hoc-derivable-category — the normative content is carried
    entirely by the parametric statement ("commands with block-typed
    params are as effectful as the blocks they receive"); no
    blocks-as-data prose needed because a dead block is just a string,
    and block params cannot unquote what they receive. daggr unmentioned.
  NOTE (claude): drafting discovery — no new WAIT variant is needed.
    Sub-processes are nested, not concurrent [subprocess-sync-dfs], so
    when a block hits an effect it is the SUB-PROCESS that WAITs on the
    port via the existing §7 machinery; the parent is blocked by
    depth-first nesting alone. The only new formal object is the
    evaluation demand (apply). E's formalism nearly disappears into
    the existing model.

REALIZE-pending: on merge of design/blockeval-spec-draft.md, mark
  #idea:hoc-finding, #idea:hoc-uniformeval-anchor, #idea:hoc-covering-rule,
  #idea:hoc-parametric-purity, #idea:hoc-derivable-category → REALIZE
  as [dd:blockeval]. #idea:hoc-ripples partially realized by the patch;
  remainder (optimizer notes, time.now family) stays open for the
  test/impl phase.

### User's own edits to blackhole-spec-draft.md (recorded)

The user revised the black hole draft directly. Notable decision changes,
superseding round-1/round-4 records:
- REVERSAL: non-port structure in a black hole definition now BORKS
  [blackhole-only-ports], superseding "ignored" (round 1 quote said
  ignored; user's edit chose the stricter rule).
- Example flavours renamed socket-* → websock-*.
- Added I10 (effect exteriority) and I3 (sender exits all ports)
  amendments — the property list and invariant list move together.
- Added spaceseed `blackhole` flag [blackhole-seed-flag].
- Added the boundary-duality framing: round-trip ports flip north/south
  (up/down), a black hole's one-way ports flip east/west — same duality,
  different axis. Strengthens #idea:bh-outerspace-dual.

## Recursion depth bound (2026-07-05)

Reviewer finding, received via user:

> "The design choice. "Trap the overflow and sploot" has two versions with
> genuinely different semantics:
> - (a) Explicit depth bound, checked at sub-process creation
> (recommended). Exceeding the bound sploots the innermost block
> evaluation: empty value + soft error to @out:err, enclosing pipeline
> continues. This is a clean value-producing sploot, deterministic given
> the bound, and — the big win — it doesn't weaken P-total, it repairs it:
> total commands + bounded depth + finite segments means every process
> terminates. The bound stays implementation-defined (sized to fit the
> host stack), so your "runtime-specific" instinct is preserved; only the
> behavior at the bound is normative.
> - (b) Trap the host stack overflow directly. Faithful to "just let it
> happen," but the effective bound then varies with how much stack is
> already consumed at the call site — the same program can succeed or
> sploot depending on topology depth and host, and where the empty value
> lands depends on where the catch sits (possibly aborting a command
> mid-write). That's hard to square with P-portable's determinism claims
> without carving out a chunk of implementation-defined behavior.
> Note (a) doesn't forbid (b) as a mechanism — the JS implementation can
> keep a cheap depth counter and catch RangeError as a backstop. The spec
> would say roughly: a new "Recursion depth" paragraph in §11
> (implementations MUST bound block-evaluation depth; the bound is
> implementation-defined; exceeding it sploots the innermost evaluation
> [depth-exceeded-sploot]), a clause added to P-total/I1 citing it, the
> false "bounded by finite source" annotation on [finalize-block] replaced
> with a citation of the bound, and the §13 DoS paragraph updated
> (recursion bounded; tight pure loops still unbounded pending energy
> limits)."

User framing:

> "This one is a little tricky, but also fairly straightforward -- worth
> unpacking together, though."

[idea:depth-finding] OBSERVATION: P-total claims "no pipeline ever
  crashes or diverges" but self-referential named blocks (and
  self-unquoting blocks) recurse unboundedly into the host stack today.
  Verified: [finalize-block] (line 3680-3682) carries the FALSE
  annotation "terminates: nesting depth bounded by finite source."
  Spec-side of the known open issue "self-referential named blocks need
  recursion depth limit."

[tension:depth-bound] #idea:depth-finding vs [P-total]/[P-portable]:
  option (a) explicit depth bound at sub-process creation, innermost
  sploot, bound implementation-defined, behavior-at-bound normative;
  option (b) trap host stack overflow — rejected-candidate: effective
  bound varies per call site within one run, and the trap fires at an
  arbitrary point (possibly mid-queue-mutation, mid-poke, mid-port
  machinery) where no sploot can guarantee repaired invariants.
  Reviewer recommends (a), (b) retained as implementation backstop.

[idea:depth-timeout-dual] PROP: the depth bound is the spatial dual of
  the down-port timeout (P-liveness, §7.2): implementation-defined
  magnitude, normative behavior at the limit, instance-level default.
  (a) introduces no new KIND of implementation-definedness — P-portable
  is already qualified this way by timeouts. Strengthens (a).

[idea:depth-single-demand-site] PROP: by P-uniformeval every evaluation
  vector (map blocks, named blocks, process run/unquote, end-of-pipe
  eval, finalize-block) is a sub-process creation — which the blockeval
  patch just formalized as the apply demand [blockeval-demand]. The
  depth check has exactly ONE enforcement point, and it's already in
  the pending draft. [depth-exceeded-sploot] hooks onto apply.

[idea:depth-instance-bound] QUESTION: should the outer-space creation
  list (§4, line 1205: seed, dialect, PRNG seed, default timeout) gain
  "a block-evaluation depth bound (or accepting the implementation
  default)"? Parallel to the timeout default; buys testability with
  small bounds and feeds #idea:runtime-isolation (per-instance resource
  limits). Cost: one more knob.

[idea:depth-portable-test] OBSERVATION: even with the bound
  implementation-defined, one test is fully portable: unbounded
  recursion MUST sploot (soft error, empty value, process completes)
  rather than crash. Assertion-labelled test material for
  [depth-exceeded-sploot] independent of the bound's value.

## Decisions round 6 (2026-07-05)

### Black hole cluster closed

> "fyi I've merged in the revised black hole patch, so you can close that
> issue on your side."

Verified in D2-spec.md: [spacesyn-blackhole] grammar (line 548), §4
section, I3/I10 amendments present.
REALIZE #idea:black-hole, #idea:bh-outerspace-dual, #idea:bh-fire-forget,
  #idea:bh-mock-swap, #idea:bh-socket-pflav-reuse, #idea:bh-glyph
  → [dd:blackhole] (merged 2026-07-05).
RESOLVE #tension:bh-serialization, #tension:bh-silent-loss — closed by
  the merge (duality rule; [blackhole-no-guarantee]).
#idea:bh-spec-today — retired (constraint met).
#idea:bh-render — REMAINS OPEN: renderers, parser, fixtures, labelled
  tests for the 17 blackhole-* assertion IDs now in the spec.
NOTE (claude): the merge shifted spec line numbers (~+7 §1, ~+60 §4,
  ~+153 §7 onward); blockeval-spec-draft.md anchors refreshed to match.

### Depth bound decided

RESOLVE #tension:depth-bound — option (a) + instance-level bound
RESOLVE #idea:depth-instance-bound — yes; system default 100
  > "Yes, I agree with (a) + instance level bound that paralells the
  > timeout. I think 100 is generous enough for a default depth bound.
  > Don't bother with (b), we will just do (a) -- every implementation
  > has a bound checker on subprocess depth, and every implemention must
  > catch whatever runtime errors it can and turn those into sploots (I
  > think this is already true, though)."
  IMPORTANCE: HIGH — makes P-total/I1 true (currently false for
    self-referential blocks); closes a known open issue.
  CONFIDENCE: HIGH.
  RIGOR: CAREFUL — reviewer options + four additional supporting
    arguments; details (nesting-only, routing reset) pinned down.
  Decisions: normative default 100, per outer space at creation (exactly
    parallel to the 10000ms timeout default); (b) dropped from spec text
    entirely; instead a GENERAL normative rule: implementations must
    catch what host errors they can and convert to sploots.
  NOTE (claude): verified the "(I think this is already true)" claim —
    partially. [flavour-error-soft] covers port-flavour lifecycle
    methods only; nothing covers command funs or general execution.
    The draft adds [host-error-sploot] as the generalization.

REALIZE-pending: on merge of design/depth-spec-draft.md, mark
  #idea:depth-finding, #idea:depth-timeout-dual,
  #idea:depth-single-demand-site, #idea:depth-instance-bound →
  REALIZE as [dd:depthbound]. #idea:depth-portable-test feeds the
  test phase.

## Sender attachment at boundaries (2026-07-05)

Reviewer finding, received via user:

> "5. Sender attachment at port flavours is unspecified (HL). Ships
> without senders run at full space dialect, flavours originate ships,
> and nothing says where identity binds between "packet arrives at
> socket-in" and "ship docks." This is the most security-relevant gap
> for the multiplayer story."

User framing:

> "This one opens up some design space that we've sidestepped, let's dig
> into it."

[idea:sender-gap-finding] OBSERVATION, grounded:
  (1) [sender-effective-default] (line 1007): "A ship without a sender
  runs under the space's dialect directly (the default case for internal
  routing, system events, etc.)" — the parenthetical shows no-sender was
  designed for INTERNAL provenance, but nothing stops boundary flavours
  from producing unattributed ships, which then inherit the internal
  default. The spec conflates "internal" with "unattributed."
  (2) The App-authority principle (line 1021: "the App is responsible
  for validating identity before passing a sender into the outer
  space") has NO mechanism: from-js's enter(ship, process) has no
  sender parameter; websock-in calls self.enter(ship) with the raw
  socket payload, senderless → full base dialect.
  (3) Payload spoofing surface: websock-add-user checks ship.user — a
  PAYLOAD field, attacker-controlled in multiplayer. Identity must ride
  the carrier, not the payload.

[tension:sender-binding] #idea:sender-gap-finding vs [P-dialect]/
  App-authority: four moments where identity could bind between packet
  and dock — transport (connection/session), flavour outside face
  (outside_add callback), the port boundary (enter), dock (process
  creation). Spec defines sender semantics from dock onward only.

[tension:sender-default] the crux: what do boundary-originated ships
  carry when nothing attaches identity?
  (a) status quo — unattributed at full base dialect (dangerous:
      every boundary flavour is a privilege-escalation vector)
  (b) anonymous/empty dialect — secure, breaks every current demo
      (dom-on-click would sploot on everything)
  (c) port-identity default — see #idea:sender-port-identity:
      attribution always, authorization unchanged by default.

[idea:sender-port-identity] PROP: every world-facing port IS an
  identity. Ships it originates carry the port's sender (id = space/
  port qualified name; dialect = base unless attenuated) unless the
  flavour attaches something more specific. Generalizes
  [blackhole-sender-identity] — the black hole rule becomes the special
  case, and the provisional #tension:bh-sender resolution gets
  CONFIRMED by generalization. Preserves current behavior (base ∩ base
  = base) while making every external ship attributable; multiplayer
  security = attenuate the port's dialect or register per-user senders.
  Connects to #idea:alias-attenuation (per-port dialect attenuation).

[idea:sender-enter-hook] PROP: the normative core is small — a
  boundary port's enter() attaches a sender; WHERE it comes from is
  the flavour's business: static (port declaration/settings), dynamic
  (transport mapping via App-registered senders), or App-passed
  (from-js grows a sender argument). websock-add-user/remove-user
  become the registry-mutation flavours they were gesturing at.

[idea:sender-carrier-not-payload] PROP: identity binds as carrier
  metadata at or before enter(); payload fields claiming identity are
  data, not identity. Stations must not derive privilege from
  __in.user. Candidate invariant for §13's multiplayer story.

[idea:sender-registry-app-side] OBSERVATION: keep the id→sender
  registry App-side (spec principle already says App validates
  externally); the spec defines only the flavour-visible hook, not
  registry lifecycle. Avoids over-speccing session management.

## Decisions round 7 (2026-07-05)

### Sender entry rule — user refinement of #idea:sender-port-identity

> "I think the suggestion is that a ship entering through a port will
> take that port's id as its sender, unless it already has a sender.
> I like this. Black hole ship entry works exactly like regular ship
> entry currently, so this change will impact both. And I believe we
> already have sender-specific dialects, so the app creator can have
> different dialects for different entry ports."

MERGE #idea:sender-port-identity + #idea:sender-enter-hook →
[idea:sender-entry-rule] PROP: a ship entering through a port takes
  that port's id as its sender, unless it already has a sender.
  Uniform — no boundary-vs-internal classification needed; applies to
  black hole ports automatically (bh entry = regular entry); ships
  with senders pass through unchanged (propagation intact). Identity
  comes from topology, authority from the App's sender registry:
  register a sender under a port's id with an attenuated dialect and
  that port's ships are confined; unregistered ids run at base
  (current behavior preserved, attribution universal).
  Verified: sender-specific dialects exist (sender = (id, dialect),
  line 986; effective dialect intersection line 1000).

[idea:port-qualified-name] PROP: the sender id for a port is its
  QUALIFIED NAME — the path of subspace names from the outer root,
  '/'-separated, ending in Astroglot endpoint syntax:
  `@in:init` (root port), `relay@in:feed` (subspace port),
  `game/player1@out:move` (nested). NOT the runtime PortId (spec line
  852 "generated at runtime"; implementation uses counters).
  Arguments: (1) determinism — sender ids are observable (error
  ships, exits [sender-propagate-exit]); runtime-generated ids differ
  across runs, breaking P-portable/P-handlersub replay; (2) the App
  must pre-register dialects keyed by these ids — only possible if
  they're readable off the Astroglot source; (3) stability across
  serialization. Uniqueness holds from existing rules: subspace names
  unique per parent (name→seed map), port names unique per space
  (duplicate-declaration bork), bare vs named ports distinct
  [port-bare-named-coexist]. PortId remains the runtime handle —
  two different things, kept distinct.

Open wrinkles (captured, not solved):
[idea:sender-socket-slot-name] QUESTION: what path component does a
  socket-LOADED subspace contribute? If the loaded space's declared
  name: identity changes per load. If a stable socket-slot name:
  attenuation policy survives swaps ("whatever runs in this socket").
  Lean: stable slot semantics, but needs a rule in §8.
NOTE (claude): anonymous inline stations need deterministic generated
  names for their ports' qualified names (layout engine already did
  this for rendering — stable station names). Multiple outer spaces:
  qualified names scoped per outer space [outer-independent]; the App
  disambiguates externally. Bonus: the spaceeditor's injected
  _repl_in port gets an attenuable identity for free.

## Decisions round 8 (2026-07-05)

RESOLVE #idea:sender-socket-slot-name — moot for now
  > "You asked about socket-loaded spaces, but at the moment there's no
  > way to have a ship come out of a socket loaded space that didn't
  > already go into it from elsewhere, because the spec currently bans
  > black holes inside socket-loaded spaces. So I think we're safe on
  > that front for now."
  Verified: [blackhole-no-socket-load] (spec lines 2369–2374). Under the
  entry rule every ship is attributed at its FIRST port, so ships inside
  socket-loaded spaces always arrive already-attributed; interior ports
  never mint identities. Reopens only if loaded black holes are ever
  allowed (the spec's own "for now it is simply disallowed" note).

RESOLVE #tension:sender-default + #tension:sender-binding — via
  #idea:sender-entry-rule + #idea:port-qualified-name
  > "Yes, go with the /-seperated subspace hierarchy, followed by the
  > regular port naming convention, so `game/player1@out:move`.
  > Move forward with that, scoped to just senders re: runtime ids, but
  > then when you're done show me what it would look like to do this for
  > all runtime ids -- it might not be much work."
  IMPORTANCE: HIGH — the multiplayer security story; reviewer's
    highest-severity gap.
  CONFIDENCE: HIGH.
  RIGOR: CAREFUL — grounded in spec + pflav code; default semantics
    preserve existing behavior; wrinkles enumerated and dispatched.
  Scope: qualified names for SENDER ids only; runtime PortId untouched.

NOTE (claude): consequence the user anticipated ("this change will
  impact both"): [blackhole-sender-identity] (merged, space-level
  identity) is superseded by port-level granularity under the uniform
  rule — `relay@out:news` subsumes space-level attribution (path
  contains the space name). Draft amends that assertion. The
  provisional flag on the old #tension:bh-sender resolution comes off:
  confirmed by generalization.

[idea:qname-all-runtime-ids] PROJECT: extend qualified names to all
  runtime ids (user request: sketch after sender patch). Inventory:
  ports/spaces/stations are topological → qnames (station names
  already can't collide with subspace names — one namespace, one path
  syntax); blocks + spaceseeds already content-hashed (done); processes/
  ships are execution instances → deterministic per-space sequence
  numbers (serial execution makes them reproducible) where observable.
  Prior art: layout engine's stable station naming. Payoffs: golden-file
  error-ship tests, reproducible traces, strengthens P-portable.

REALIZE-pending: on merge of design/sender-spec-draft.md, mark
  #idea:sender-entry-rule, #idea:port-qualified-name,
  #idea:sender-carrier-not-payload, #idea:sender-gap-finding →
  REALIZE as [dd:sender-entry]. #idea:sender-registry-app-side folds
  into the same dd.

## Decisions round 9 (2026-07-05)

RESOLVE #idea:qname-all-runtime-ids — full approach approved, folded
into the sender patch (per user: "Good, write that up, with the full
QNames / deterministic ids everywhere approach" / "(Add it to the
sender draft patch)").
  IMPORTANCE: MED-HIGH — upgrades P-portable to byte-level determinism;
    new invariant I16.
  CONFIDENCE: HIGH.
  RIGOR: MODERATE — grounded (error ships carry string + sender only;
    SpaceseedId had no stated generation rule, now content-hash
    normative; anon-station convention `s1, s2, ...` already exists in
    the codebase); implementation follow-ups listed in the draft, not
    yet costed.
  sender-spec-draft.md rewritten: 8 edits, 11 assertion IDs
  (5 sender-*, 6 identity), test material incl. byte-determinism and
  anon-naming tests, implementation follow-ups noted (thread qnames
  through constructors, per-space process sequence, leak-site audit).
  On merge: REALIZE #idea:qname-all-runtime-ids into [dd:sender-entry]
  (same dd as the sender cluster).

## Deterministic scheduler (2026-07-06)

> "We're going to need a deterministic scheduler -- without that, we're
> still wrestling with non-deterministic docking of ships across and
> between subspaces, which weakens all the determinism guarantees we'd
> like to make. Let's dig into that. It's a complicated topic, with
> intersection points in quite a few sections of the spec, so take some
> time to familiarize yourself before we start the design session."

[idea:sched-goal] DESIRE: deterministic scheduling of ship docking
  across and between subspaces, upgrading the determinism guarantees
  (I16, P-portable, P-handlersub) from per-space to whole-tree.

[idea:sched-nondet-inventory] OBSERVATION — where nondeterminism lives:
  1. SIBLING INTERLEAVING: spec line 1572 "sibling subspaces...can
     process ships concurrently" — no interleaving rule. Observable
     whenever siblings' outputs converge on a common target (parent
     station, third sibling): its queue order differs run to run.
  2. THE DEFER PRIMITIVE: per-process routing order is specified
     [routing-deferred-order], but cross-space deferred-entry order is
     not. Implementation: all deferral funnels through D.setImmediate
     (4 call sites; lib/setimmediate.js → host setImmediate /
     postMessage / setTimeout fallback) — host macrotask ordering,
     not guaranteed across classes or hosts.
  3. TIMEOUTS: wall-clock timers race responses [timeout-ghost-drop];
     firing order vs other events is host timing.
  4. EXTERNAL ARRIVALS: App inputs, socket packets, DOM events, black
     hole emissions, App-side down-port responses — genuinely external.
  5. SOCKET OVERLAP: old subspace drains WHILE new is live
     [socket-overlap-drain] — two live spaces, interleaving unspecified.
  Already deterministic: per-space FIFO [queue-fifo], queued-before-
  routed [queue-priority-routing], per-process routing order
  [routing-deferred-order], sub-processes [subprocess-sync-dfs],
  per-space PRNG, effective-dialect memoization.

[idea:sched-input-schedule] PROP: target theorem — given (topology,
  initial state, PRNG seed, ordered schedule of external events),
  execution is byte-identical. Requires defining "external event":
  boundary in-port entry, App-side response arrival, clock advance.
  Everything between external events must be internally deterministic.

[tension:sched-internal-vs-external] where is the input line? An App
  response is external; a response served by a sibling via up-port
  wiring is INTERNAL and must be derived deterministically; a timeout
  is a clock event — and the clock itself is the question of
  #tension:sched-time.

[tension:sched-time] wall-clock vs logical time. P-liveness depends on
  real timers in production; determinism wants a virtual clock.
  Candidate cut: make time an INPUT — timeouts become clock events on
  the external schedule (production: wall clock feeds the stream;
  test/replay: virtual clock feeds it deterministically). The
  scheduler is deterministic modulo the clock stream.

[tension:sched-granularity] the model-shape decision:
  (a) global ready-queue — one logical run loop per outer space tree;
      every deferred entry/dequeue/resumption enqueues FIFO with
      deterministic tie-breaks. Total order, simple.
  (b) per-space queues + deterministic merge rule (e.g., round-robin
      over ready spaces by qname per tick).
  (c) segment-tick model from D2-concurrent-scheduling.md — ready-
      continuation queue that later generalizes to ready-segment for
      intra-space concurrency. Under serial-per-space, (c) reduces to
      (a) with future-proof item granularity.

[tension:sched-fairness-liveness] a fixed total order must not starve
  spaces; P-liveness preserved; perf cost of a run-queue vs free host
  scheduling (perf_test watches this).

[tension:sched-socket-overlap] the overlap drain needs its own
  deterministic interleaving rule (old-drain vs new-live ordering).

[idea:sched-qname-tiebreak] OBSERVATION: deterministic tie-breaking
  needs stable identities — the sender/QName patch just provided them
  (space qnames, per-space process sequences). The patches stack.

[idea:sched-choke-point] OBSERVATION (implementation): D.setImmediate
  is the seam — replace its 4 call sites with a run-queue and the
  scheduler is centralized; timeouts join via the clock stream.

Intersection map: §1 (P-serial, P-fresh, P-portable, P-handlersub,
I6, I9/P-liveness, I16), §5 (queue, DEFER, sibling sentence), §6
(up-port response paths, ghost ships), §7 (WAIT/RESUME, §7.2
timeouts), §8 (socket overlap), §4 (black hole emissions as external
events; PRNG), D2-concurrent-scheduling.md (TICK model), §14.

### Model shape session (2026-07-06)

> "My first inclination was (b), because a per-space queue maps to how I
> already think about the system, and I like breaking things apart and
> keeping them loose whenever possible. But the argument for a global
> queue has benefit as well. What is the segment tick model?"

[idea:sched-axes] PROP: (a)/(b)/(c) are not three models — the space
  decomposes into independent axes:
  Axis 1 — ORDERING RULE (the real tension): causal arrival order
    (dock in the order sent, globally — (a)'s FIFO) vs positional
    rotation (round-robin cursor over ready spaces — (b)'s merge).
  Axis 2 — ITEM GRANULARITY (cheap): queue items as continuations
    ((c)'s contribution) vs whole ships. Continuations future-proof
    for intra-space concurrency; under serial-per-space they behave
    identically.
  Axis 3 — PRESENTATION: spec written globally vs compositionally.
    Per-space FIFOs + per-parent forwarding in emission order is
    provably equivalent to one global FIFO — so the text can be
    compositional (b's soul) while the semantics is global arrival
    order (a's simplicity). The single queue becomes a theorem and
    an implementation strategy, not a spec primitive.

Forces on Axis 1:
  - EXPLAINABILITY: FIFO = "ships dock in the order they were sent."
    Rotation order depends on cursor state not derivable from the
    ships' causal history ("why first?" → "where the cursor was").
  - FROZEN POLICY: determinism makes the schedule part of semantics —
    the rule is forever (replay/goldens depend on it). Favors the
    simplest committable rule.
  - FAIRNESS BIAS: FIFO lets a prolific process's emissions cluster;
    rotation throttles per-space but that "fairness" is itself a bias,
    and serial-per-space already limits flooding (one process per
    space at a time).
  - LOOSE COUPLING (user's instinct + spec aesthetic, I8): no global
    object in the spec — satisfied by Axis 3's compositional
    presentation rather than by rotation.

### Round: user challenges Axis 3 (2026-07-06)

> "What does "per-parent forwarding in emission order" mean? I'm not
> seeing how we get "provably equivalent to one global FIFO" from
> nested per-space FIFOs without a lot of work.
> I'm also not sure we want equivalence to one global FIFO -- if one
> space is getting a lot of traffic, other spaces may starve, if things
> are dequeued strictly in global insertion order. (We may lose all
> inter-space concurrency benefits, for instance.)
> And what about a space that sends ships into itself? Well, maybe that
> would be okay, ships docking from the outside would still work their
> way through the queue."

CONCESSION (claude): the equivalence claim was overstated. What comes
  free is only: local FIFO per space + per-source emission order
  [routing-deferred-order]. The missing piece is exactly the ordering
  of causally-INCOMPARABLE insertions at a shared queue — which is the
  whole problem. Distributed determinism-equivalence is the hard
  direction (conservative distributed DES, Chandy-Misra lookahead —
  the "lot of work" the user smelled).

[idea:sched-convergence-only] PROP (reframe, prompted by the
  challenge): determinism does NOT require a total order. It requires
  a deterministic ORDER AT EACH CONVERGENCE POINT — a queue receiving
  from multiple causally-independent sources. Causally independent
  regions may interleave or run in parallel freely; only merges must
  be deterministic. Global FIFO is sufficient but over-serializes;
  it also answers the user's concurrency worry: a partial-order spec
  preserves inter-space parallelism (future workers/instances) by
  construction. Anchor: the spec already HAS one local deterministic
  merge rule — [queue-priority-routing] (queued beats newly-routed).
  This generalizes it.

[idea:sched-vtime] PROP (leading candidate merge rule): virtual time /
  discrete-event style. Ships carry logical timestamps; a process at
  vtime t emits at t+1; each queue is a priority queue on (vtime,
  emitter qname, emission ordinal). Compositional — timestamps travel
  WITH ships, no global structure in the spec; the single global
  event list becomes merely the reference implementation. Unifies
  with #tension:sched-time: timeouts and external arrivals are events
  stamped into the same vtime stream (external events stamped at the
  current frontier). Self-feeding chains advance +1 per hop, so
  external arrivals slot in at the frontier rather than behind an
  unbounded chain — natural fairness without a cursor.

NOTE (claude): starvation correction — global FIFO is technically
  starvation-free (everything enqueued runs in bounded order); the
  real phenomenon is BURST LATENCY (B's one ship behind A's thousand).
  Rotation fixes burst latency at the cost of causal explainability;
  vtime matches rotation on chains (each hop +1) and matches FIFO on
  bursts (a burst shares one vtime, tie-broken by ordinal).

NOTE (claude): user's self-send intuition confirmed under all
  candidate rules: self-sent ships join the space's own queue;
  outside ships already queued dock first [queue-priority-routing];
  under vtime each self-hop costs a tick so external ships interleave
  at the frontier. With the depth bound handling recursion and the
  queue handling iteration, self-feeding is safe by construction.

NOTE (claude): vtime walkthrough (2026-07-06) used these PROVISIONAL
  stamping choices, not yet decided: external events stamped at the
  scheduler frontier; time advances +1 per process (dock→emit), port
  hops are free [routing-no-process]-style; merge key =
  (vtime, emitter qname, emission ordinal). These are the open
  details named at the end of the Axis-3 round.

### Round: loop vs stamps (2026-07-06)

> "What does that get us over per-station FIFO queues? Seems like a lot
> of bookkeeping, but I'm not seeing the gain.
> Also, what is setting the ticks?
> Also, what decides which subspace goes next?"

[tension:sched-loop-vs-stamps] the sharpened Axis-1 tension. Plain
  FIFO queues alone are NOT a candidate (arrival order at fan-ins IS
  the nondeterminism). The real alternatives:
  X — DETERMINISTIC LOOP + dumb FIFOs: one run loop per universe with
    a fixed discipline; arrival order everywhere becomes deterministic
    as a consequence. Zero per-ship bookkeeping. The semantics IS the
    loop: conformance and replay require simulating the reference
    machine's walk; parallel/concurrent futures must re-derive the
    loop's order to conform.
  V — VTIME STAMPS: order defined on the ships (causal depth), machine-
    independent. Any execution strategy that sorts fan-in merges
    correctly conforms — single loop, workers, the concurrent model.
    Cost: one integer on the carrier (rides next to {sender}).
  Same determinism today; the difference is whether the ORDER'S
  DEFINITION lives in a machine or in the data.

NOTE (claude): bookkeeping is smaller than it looks — single-source
  queues (the common case) never sort and stay plain FIFOs; only
  fan-in queues consult stamps. The carrier already exists (sender
  work); vtime is a second field on it.

Answers given (provisional mechanics):
  - Ticks: set by nobody — Lamport-style derived bookkeeping (dock at
    t → emit at t+1). The runtime injects numbers only when stamping
    external arrivals at the frontier; in a single-loop implementation
    the frontier is just the stamp of the item being processed.
    (Distributed frontier-tracking is where the hard research lives —
    named honestly, not needed for the single-loop reference.)
  - "Which subspace next": semantically unordered (the feature) —
    any order respecting per-queue merges conforms. The reference
    loop pops smallest (vtime, qname, ordinal).
  Crossover condition stated to user: if Daimio is forever a single
  loop, X wins on simplicity; V pays one integer to keep the
  semantics machine-free (workers, distributed, concurrent model,
  partial replay).

### Round: the true tie (2026-07-06)

User's minimal fan-in probe: outer fans @in to A and B; both emit at
t=1 to C. Same vtime — a genuine causal tie.

> "Which arrives at C first, the ship from A or the ship from B? With
> your earlier example, it depended on B doing an extra loop to offset
> them. But here it depends on whether A runs before B or vice versa.
> Who decides that?"

Answer given: NOBODY decides "who runs first" — under vtime that
question is not semantic for independent work (either wall-clock order
is invisible). The semantic question is only the merge order at C, and
at a true tie the TIE-BREAK decides. Every deterministic scheduler
hides a coin at true ties (X: loop discipline; rotation: cursor;
vtime: explicit key). The design question is where the coin is legible.

[tension:sched-tiebreak] which coin:
  (i) emitter qname — simple, but BREAKS ALPHA-EQUIVALENCE: renaming
      space A to Z flips C's dock order. Renames should be inert.
      Non-local (the rule lives nowhere visible).
  (ii) wire declaration order at the convergent port — C@in's incoming
      wires (A@out -> C@in before B@out -> C@in) rank ties by source
      order. LOCAL (visible exactly where convergence is declared),
      name-independent, matches the spec's "wiring order matters"
      spirit [routing-deferred-order] and "the space definition
      controls routing" philosophy. Reordering wires changes behavior
      — but that reads as behavioral, unlike a rename.
  (iii) X's implicit answer for contrast: loop discipline ≈ wiring
      order via dock sequence, but buried in the machine.

REVISION (claude): walkthrough's provisional merge key
  (vtime, emitter qname, ordinal) revised → (vtime, wire index at the
  convergent port, within-wire sequence). Supporting model: WIRES ARE
  ORDER-PRESERVING CHANNELS (FIFO per wire, inherited recursively from
  [routing-deferred-order]); fan-in ports merge across wires by
  (vtime, wire declaration order). Kahn-network-with-timestamps shape.
  Same-wire same-vtime collisions resolve by within-wire order, which
  is deterministic upstream.
