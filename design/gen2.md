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
