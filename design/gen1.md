# gen1 — working file
predecessor: none (first generation)
opened: 2026-07-04

## Standing threads (seeded from project memory)

Captured so the ledger carries them; each points at its memory file for detail.

[idea:split-1-daimio] PROJECT: break 1_daimio.js (~3470 lines) into ~8 modules
  along natural seams. Detail: memory/project_split_1_daimio.md
DEFER #idea:split-1-daimio — standing thread, not today's focus.

[idea:runtime-isolation] PROJECT: isolated Daimio instances — separate state,
  memory limits, killable. Would also fix D.SPACESEEDS contamination between
  fixture runs. Detail: memory/project_runtime_isolation.md
DEFER #idea:runtime-isolation — standing thread, not today's focus.
NOTE (claude): connects to #idea:black-hole — an external app in a black hole
  is isolation taken to the limit: the "isolated instance" isn't even in the
  runtime. If black holes work well, some runtime-isolation use cases might be
  served by putting the other instance behind a black hole instead.

[idea:alias-attenuation] PROJECT: three levels of command restriction;
  DAML-in-aliases idea deferred. Detail: memory/project_alias_attenuation.md
DEFER #idea:alias-attenuation — standing thread, not today's focus.

[idea:explore-topics] PROJECT: queue of topics for deep exploration.
  Detail: memory/project_explore_topics.md
DEFER #idea:explore-topics — standing thread, not today's focus.

[idea:space-spec-gaps] PROJECT: 23 RED space_test tests guiding unimplemented
  spec behaviors — up-ports, `<->` round-trip wiring, command port
  demand-creation, wiring rule targets, error routing by name.
DEFER #idea:space-spec-gaps — standing thread; note #idea:black-hole may
  intersect (up-port mechanics, error routing).

## Black Hole (2026-07-04)

> "Right now we're focusing on a new feature called a Black Hole. It's a
> subspace, similar to the "socket" subspace, but there's an external app
> that sits inside it. So it functions a bit like the Outerspace: ships that
> go through an "in" port on the black hole disappear from the Daimio
> runtime, just like ships that go into an "out" port from the Outerspace.
> And conversely ships can emerge from the black hole through its "out" port
> into the Daimio runtime, just like "in" ports from the Outerspace.
> This is fairly straightforward on the surface, but will probably open up
> some interesting territory. I'll pin some of those decisions for later,
> because I want to get this into the spec today, and then have time to
> upgrade the test suite as well."

[idea:black-hole] DESIRE: a subspace containing an external app. Ships
  entering its in port leave the Daimio runtime; ships emerging from its out
  port enter the runtime. The interior boundary behaves like the outermost
  boundary, inverted.

[idea:bh-spec-today] LIMIT: black hole must land in D2-spec.md today, with
  test-suite upgrades after. Non-blocking decisions get pinned (DEFER).

[idea:bh-outerspace-dual] OBSERVATION: the black hole is the outermost
  boundary folded inward. Outermost space: Daimio inside, world outside.
  Black hole: world inside, Daimio outside. In/out port roles mirror exactly
  (bh in-port ≙ outermost out-port; bh out-port ≙ outermost in-port).
NOTE (claude): if the spec defines black holes via this duality, most
  semantics (fire-and-forget, no correlation, queueing on entry) come for
  free by citing the existing outermost-boundary rules rather than
  restating them.

[idea:bh-fire-forget] PROP: a black hole's in and out ports are two
  uncorrelated fire-and-forget streams — no request/response pairing across
  the boundary. Consistent with [P-singleresponse]'s rule that "if the
  outside wants to send multiple values, it uses an in-port."

[idea:bh-mock-swap] PROP: by space-boundary opacity [I8]/[space-inside-opaque],
  a parent cannot observe what's inside a subspace — so a black hole with a
  given port signature is indistinguishable from an ordinary subspace with
  the same signature. Testability story: swap a black hole for a mock
  subspace (or vice versa) and the parent can't tell.
NOTE (claude): this is the candidate creative cut for
  #tension:bh-effect-locality — the black hole doesn't break testability
  because mocking happens at the subspace boundary, same as always.

[idea:bh-socket-pflav-reuse] OBSERVATION: socket-in/socket-out pflavs
  already implement each half of the boundary crossing (external event →
  port.enter; port exit → external emit). A black hole may be, in
  implementation, a packaging of paired external pflavs into a subspace
  shell. But note socket pflavs bind a single global D.Etc.socket — a black
  hole needs per-instance binding (which app sits inside *this* hole), and
  multiple black holes need multiple apps.

[tension:bh-effect-locality] #idea:black-hole vs [P-effectlocal]:
  the spec says "Effects only occur at the outside of the outermost space."
  A black hole makes ships leave/enter the runtime at an interior boundary.
  Either the principle's wording must generalize (effects occur only at
  runtime boundaries — the outermost space is one; black holes are others),
  or black-hole crossings must be defined as not-"effects" (they are ship
  transfers through ports, not command-invoked port requests). Blocks
  today's spec edit — the wording of P-effectlocal is directly affected.

[tension:bh-declaration] #idea:black-hole vs [spacesyn-subspace-before-ref]:
  spacesyn requires a subspace to be *defined* before it's referenced, and a
  subspace definition supplies the inner topology that creates its ports
  [port-no-parent-implicit]. A black hole has no inner topology — nothing
  exists to declare its ports or its identity as a black hole. Needs a
  declaration form (a subspace kind? a flavour? settings naming the external
  binding?) before it can appear in the spec's syntax section. Blocks today.

[tension:bh-sender] #idea:black-hole vs sender/dialect propagation:
  every process runs with a sender whose dialect intersects the space's.
  Ships emerging from a black hole originate from an external app — what
  sender do they carry? Options: the black hole itself is a bound sender
  identity (fixed at declaration); or the ship's carrier names a sender the
  external app claims (needs trust/attenuation); or emerging ships get the
  parent space's ambient sender (weakest). Security-relevant — connects to
  #idea:alias-attenuation. Likely needs at least a default stated in the
  spec today, even if the full story is pinned.

[tension:bh-serialization] #idea:black-hole vs ships-as-values:
  ships inside the runtime can carry blocks (compiled DAML) and other
  runtime-flavored values. Crossing a black hole boundary means leaving the
  runtime — what survives? Plain data only? Stringified blocks? Forbidden
  with an error? Same question exists at the outermost boundary today, so
  the answer may be "whatever the outermost boundary does" (see
  #idea:bh-outerspace-dual). Pinnable if the duality answer is accepted.

[tension:bh-silent-loss] #idea:black-hole vs observability/error routing:
  if the external app is dead, disconnected, or slow, ships entering the
  black hole vanish with no trace and no error. Is silent swallowing the
  contract (the name says yes — nothing escapes a black hole, no
  liveness question arises because nothing waits [P-liveness untouched]),
  or does the parent need a signal (error route, connection-state port)?
  Pinnable — but the spec should say explicitly that entry is
  fire-and-forget with no delivery guarantee, so the pin is recorded in
  the semantics rather than left ambiguous.

[idea:bh-updown-ports] QUESTION: do black holes get down/up ports too — can
  the external app make request/response calls into the Daimio side, or the
  Daimio side into the app? Today's scope is in/out only (per the user's
  framing). Interesting territory; candidate pin.
DEFER #idea:bh-updown-ports — user scoped today to in/out ports.

[idea:bh-render] TASK: black holes need a spacesyn form, extraction in
  space_layout.js, rendering in space_ascii.js/space_svg.js (visual marker
  distinguishing them from ordinary subspaces), parser support in
  space_ascii_parse.js, and test fixtures. Follows #tension:bh-declaration.

## Decisions round 1 (2026-07-04)

RESOLVE #tension:bh-effect-locality
  > "Yes, a black hole is a flavour of space, just like "socket-in". It has
  > the same boundary semantics wrt signatures -- whatever the app is, the
  > ships that emerge from it are indistinguishable from an ordinary
  > subspace with the same port types. And yes re effects at those
  > boundaries. Black holes change the topology of the Daimio surface (it
  > becomes a higher genus by putting holes in it) but the principle is
  > unchanged."
  IMPORTANCE: HIGH — reshapes P-effectlocal, the principle behind testability.
  CONFIDENCE: HIGH — clear structural picture (higher-genus framing).
  RIGOR: MODERATE — accepted the mock-swap cut plus own topological framing;
    not adversarially stress-tested.
  NOTE (claude): this absorbs #idea:bh-mock-swap (confirmed: emerging ships
    indistinguishable from an ordinary subspace with the same port types).
    P-effectlocal generalizes to: effects occur only at boundaries of the
    Daimio surface — the outermost edge is one boundary; each black hole
    adds another (higher genus). The testability claim is untouched because
    mocking happens at the subspace boundary, as always.

[idea:space-flavours] PROP: spaces have flavours, parallel to port flavours.
  "blackhole" is the first non-default space flavour. New spec concept
  introduced by resolving #tension:bh-effect-locality.
NOTE (claude): this quietly generalizes the spec — once space flavours
  exist, other flavours become possible. Recorded so the door is opened
  deliberately, not accidentally.

RESOLVE #tension:bh-declaration
  > "A black hole is mostly a regular subspace that declares its ports. The
  > difference is that for a blackhole flavoured subspace A) any structure
  > beyond port declarations is ignored (eg stations are ignored) and B)
  > the "inside" portion of the ports are treated as though they're on the
  > outermost edge, so all their effectful aspects operate, instead of
  > being overridden by the basic internal port mechanisms."
  IMPORTANCE: HIGH — this is the whole declaration + mechanism story.
  CONFIDENCE: HIGH on shape; port-flavour details still open
    (#idea:bh-port-flavours).
  RIGOR: MODERATE.
  NOTE (claude): (A) "ignored" is the decided word — stations etc. in a
    blackhole-flavoured subspace are silently ignored, not a spacesyn
    error. (B) implies flavour direction inversion: a black hole in-port's
    inside face behaves like an outermost OUT-port's outside face (emits
    toward the app), and its out-port's inside face behaves like an
    outermost in-port (listens to the app). Spec text must keep `dir`
    meaning the parent-facing role while the effectful inside-face
    behavior is the inverse.

[idea:bh-port-flavours] QUESTION:
  > "Note: we'll need ports that make sense here -- the simplest will just
  > be versions of the outermost in/out ports, but inverted. But they'll
  > need to take some kind of "target" or something, so the outside thing
  > can route them properly..."
  Open: flavour names, settings schema, routing.
NOTE (claude): candidate proposal — each blackhole port flavour takes a
  `target` setting naming the external channel, defaulting to the port's
  own name. Mirrors socket-in's channel setting (settings.thing) and is
  zero-config in the common case. Soft-blocks the spec's syntax examples,
  not the mechanism text.

RESOLVE #tension:bh-sender — provisional
  > "Yes, let's say for now that ships from a black hole have the identity
  > of that black hole space."
  IMPORTANCE: HIGH — security-relevant: dialect confinement of emerging ships.
  CONFIDENCE: MEH — explicitly "for now"; revisit when the attenuation
    story matures (#idea:alias-attenuation).
  RIGOR: YOLO — chosen as a safe default, not analyzed deeply.
  NOTE (claude): spaces are not currently sender entities; this makes the
    black hole space itself a sender identity. Since subspaces inherit the
    parent dialect [I2], emerging ships are confined to the parent's
    dialect — consistent with P-compose (a loaded subspace never exceeds
    host permissions). Declaring an attenuated dialect on a black hole is
    the natural future extension.

NOTE (claude): #tension:bh-serialization is now anchored by the duality
  accepted in the effect-locality resolution — the answer is "whatever the
  outermost boundary does." Still pinned, but no longer ambiguous in kind.

## Decisions round 2 (2026-07-04)

### Pushback on #idea:space-flavours

> "You said "spaces having flavours" is a new idea, but @D2-spec.md already
> talks about the "socket-in" flavour of subspaces. So the "blackhole"
> flavour definitely isn't the first one. We could name this something
> different -- subspace "type" instead of "flavour", but the spec already
> has this notion."

NOTE (claude): checked — every "flavour" in D2-spec.md is port-level
  (grammar line 529, port tuple line 1016, Port flavours section 1241+).
  Socket spaces are a DERIVED designation: "A socket is any space that has
  a port of flavour 'socket-in'" (line 2146-2149). Blackhole-ness cannot be
  derived the same way: the same space definition can run as outermost or
  be loaded as a subspace (compose-to-test, P-effectlocal); if effectful
  flavours auto-activated on subspaces, such spaces could never be mocked
  by composition again. So blackhole-ness must be declared, not derived —
  it IS a new space-level concept. Recommend "type" over "flavour" to
  avoid overloading the port-flavour contract. Awaiting user's naming call.

MERGE #idea:space-flavours → [idea:space-types] PROP: subspaces have a
  declared type; the default is an ordinary space, "blackhole" is the
  first non-default type. Distinct from port flavours (a behavioral
  contract) and from derived designations like socket spaces. Naming
  ("type" vs "flavour" vs other) pending user decision.

### Routing metadata (resolves the "target" question)

RESOLVE #idea:bh-port-flavours — by simplification:
  > "I don't think there are any "blackhole port flavours". I think there's
  > just port flavours, and some of those are ideal for blackholes and some
  > aren't, but all of them could be used on other space types. I think
  > what I was trying to get at is that a blackhole space needs a piece of
  > metadata -- which could just be its existing identifier -- that gets
  > added to the ships sent out of it that go to the outer runtime (which
  > is responsible for dispatching from there). So this can be really
  > simple for now."
  IMPORTANCE: MED — unblocks spec syntax examples.
  CONFIDENCE: HIGH on shape ("really simple for now").
  RIGOR: MODERATE.
  Port flavours remain one universal pool; no blackhole-specific flavours.
  Ships crossing outward through a black hole are stamped with the black
  hole's identifier; the host runtime dispatches on it.
NOTE (claude): the carrier probably wants {blackhole-id, port-name} so an
  app behind a hole with several in-ports can distinguish channels —
  port-name is one field, still "really simple." Flag for the spec edit.
NOTE (claude): pleasing consequence of the universal pool: a socket-backed
  black hole needs zero new flavours — @in ports carry socket-out, @out
  ports carry socket-in.

### Port inversion (open — user on the fence, asked for a push)

[tension:bh-port-inversion] #idea:black-hole vs flavour orientation:
  > "I'm not sure which is better yet, to invert the ports automatically on
  > a blackhole, or to make new port flavours that are manually flipped.
  > The second is conceptually cleaner. The former is a little more
  > ergonomic. I'm on the fence; give a push."
  Option A: blackhole type auto-inverts its ports' flavour orientation.
  Option B: declarations name the true flavour explicitly ("manual flip").
NOTE (claude): push = B, via a reframe that removes the "flip" entirely.
  Port dir is PARENT-relative (which way ships flow vs the parent).
  Flavour dir is RUNTIME-BOUNDARY-relative (in = ships enter the runtime,
  out = ships leave it). At the outermost edge the two coincide — which is
  why the distinction has been invisible. At a black hole they oppose,
  because boundary orientation reverses at a hole (the user's own
  higher-genus framing predicts this). So B declares the truth; nothing is
  inverted. Supporting arguments: (1) keeps the flavour contract
  context-free — A makes the same declaration mean different behavior
  depending on containing space type, and requires a flavour-inverse
  registry that fails for flavours without inverses (what is the inverse
  of dom-on-click?); (2) keeps the effect surface legible in source
  (spec values explicit effect surfaces); (3) A's ergonomic win is small —
  blackhole declarations are rare and short — and B's ergonomic cost can
  be erased by a spacesyn validation rule: on a blackhole subspace, port
  dir and flavour dir must oppose (error otherwise); at the outermost
  edge they must match.

## Decisions round 3 (2026-07-05)

### Space naming: no types — a glyph

> "Yes, I agree wrt the space naming: "flavour" is only for ports. I think
> a black hole is different enough from a subspace, and unique enough in
> its shape, that it does not require introducing a "type" of space. So
> maybe syntax-wise it's a glyph or marker of some kind on the space's
> label in astroglot."

REJECT #idea:space-types — Reason: black hole is sui generis; opening a
  general "kind of space" dimension in the spec is unwarranted for one
  inhabitant. "Flavour" stays exclusively port-level.
  IMPORTANCE: MED — spec-surface minimalism; closes the generalization
    door flagged in rounds 1-2 (deliberately, as hoped).
  CONFIDENCE: HIGH.
  RIGOR: MODERATE — the sui-generis claim leans on black holes staying
    the only marked kind.
  NOTE (claude): the round-2 requirement (blackhole-ness must be DECLARED,
    not derived from ports) survives — a glyph on the label is a
    declaration. Caveat recorded: nearest candidate for a second marked
    kind is #idea:runtime-isolation (remote instance behind a boundary) —
    but that convergence supports the rejection, since a remote instance
    presented as a black hole IS a black hole. If a genuinely distinct
    second kind ever appears, glyphs extend gracefully (second glyph) with
    a mechanical migration path to a formal field. Revisit only then.

[idea:bh-glyph] DD-CANDIDATE: blackhole-ness is declared by a glyph/marker
  on the space's label in astroglot (the source format), carried through
  spacesyn grammar, ASCII/SVG renderers, and the ASCII parser round-trip.
  Open sub-question: WHICH glyph — must be ASCII-safe (renderers), a legal
  non-colliding token in spacesyn labels, and visually evocative.
  Feeds #idea:bh-render (renderers + parser + fixtures follow the choice).

RESOLVE #tension:bh-port-inversion — by cut (option B, two-boundaries reframe)
  > "Agree on the option B / explicit flavours framing."
  IMPORTANCE: HIGH — keeps the port-flavour contract context-free; fixes
    what dir means, permanently.
  CONFIDENCE: HIGH.
  RIGOR: CAREFUL — alternatives argued explicitly (auto-invert rejected:
    action at a distance, inverse registry, no inverse for dom-on-click).
  CONSTRAINT (carried forward from this point):
    Port dir is PARENT-relative; flavour dir is RUNTIME-BOUNDARY-relative
    (in = ships enter the runtime, out = ships leave it). They coincide at
    the outermost edge and oppose at a black hole. There is no "inversion"
    anywhere — do not revert to inversion framing in spec text, code, or
    discussion.
  Derived spec-assertion candidate: on a blackhole subspace port, dir and
    flavour dir must oppose (spacesyn error otherwise); at the outermost
    edge they must match. Future RED test material (test-suite upgrade
    phase; relates to #idea:space-spec-gaps style guidance tests).

## Decisions round 4 (2026-07-05)

### Glyph chosen

RESOLVE #idea:bh-glyph (sub-question: which glyph)
  > "Let's do `((label))` for the glyph. The double paren looks more
  > deliberate. Go ahead and draft it."
  IMPORTANCE: LOW-MED — aesthetic + three consumers (grammar, renderers,
    parser round-trip).
  CONFIDENCE: HIGH.
  RIGOR: YOLO — taste call, cheap to change before tests exist.
  NOTE (claude): `((` at column 0 collides with nothing in the Astroglot
    grammar (names are [a-z]..., comments are `/`, state is indented `$`).
    Glyph appears at the definition site only; wire endpoints reference
    the bare name.

### Spec draft produced

Draft written to design/blackhole-spec-draft.md — six edits against
D2-spec.md, drafted from rounds 1–4. Proposes 16 new assertion IDs
(blackhole-* plus spacesyn-blackhole) for test traceability.

NOTE (claude): two gaps the ledger hadn't covered; calls made in the
  draft, flagged for user review:
  1. Bare port declaration on a black hole (no flavour given): the
     per-direction default would produce a MATCHING flavour dir, which
     violates the opposition rule. Draft resolves via the two-boundaries
     constraint itself: on a black hole the default flavour is the generic
     flavour of the OPPOSING direction [blackhole-default-flavour] — a
     bare @in becomes a pure sink, not a bork.
  2. Root space declared as a black hole: structurally meaningless (no
     parent side, nothing but hole). Draft makes it a bork
     [blackhole-not-root].
  Also scoped in the draft per round-1 deferral: up/down ports on a black
  hole are a bork [blackhole-inout-only] — REALIZEs the DEFER of
  #idea:bh-updown-ports as an explicit exclusion rather than silence.

REALIZE-pending: once the draft is merged into D2-spec.md, mark
  #idea:black-hole, #idea:bh-outerspace-dual, #idea:bh-fire-forget,
  #idea:bh-glyph, #idea:bh-mock-swap → REALIZE with [dd:blackhole].
  #idea:bh-render remains open (test-suite + renderer phase).
