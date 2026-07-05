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
