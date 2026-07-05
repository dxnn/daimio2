# Black Holes — draft edits for D2-spec.md

Drafted 2026-07-05 from design/gen1.md (decision rounds 1–4).
Six edits, ordered by spec position. Line numbers refer to the current
D2-spec.md. New assertion IDs use the `blackhole-` prefix (16 total).

---

## Edit 1 — Amend [P-effectlocal] (§1, lines 158–167)

Replace the section body with:

> ### Effect locality [P-effectlocal]
> Effects only occur at runtime boundaries -- the places where the
> Daimio surface meets the real world. The outside of the outermost
> space is one such boundary. Each black hole (section 4, "Black
> holes") adds another: a subspace whose interior is the real world,
> so its ports sit on the runtime boundary despite lying in the
> interior of the topology. Black holes raise the genus of the
> surface; the principle is unchanged.
>
> Every effectful command invocation within a space produces a port
> request. Port requests propagate outward (via down-port forwarding
> through parent spaces) until they reach the outermost space, where
> real effects occur. Any intermediate space can intercept and handle
> the request (via up-port wiring to a subspace or a local handler).
> This is the mechanism behind testability: any space can be tested
> by composing it into a parent that provides mock handlers, and the
> space cannot tell the difference from the inside.

(Second paragraph is unchanged from the current text; only the opening
paragraph is new.)

Also amend the two invariants that state the same principle in
normative form — the property list and the I1–I15 list are maintained
separately, so both must move together.

**I10 (§1, line 364)** — replace with:

> **I10. Effect exteriority.** Effectful commands produce port
> requests, not direct effects. Real effects occur only at a runtime
> boundary — the outside of the outermost space, or a black hole's
> port boundary (§4, "Black holes"). Effectful port requests
> propagate outward until they reach such a boundary, where the
> App's handler executes them; a ship that reaches a black hole's
> in-port leaves the runtime there. No space can cause a real-world
> effect except at a runtime boundary.

**I3 (§1, line 329)** — replace the final sentence:

> The sender exits all ports, including runtime boundaries: the
> outermost boundary to the App, and any black hole crossing to its
> external app (§4).

---

## Edit 2 — Design Decisions Record (§2, after "Why channel-independent
messages?", line 481) — optional

> ### Why black holes instead of world-facing stations?
> An outer space already talks to the world through its port flavours,
> but that boundary is at the edge, and applications need world-facing
> components in the *middle* of a topology: an external service that
> the rest of the space wires to like any sibling subspace. A black
> hole packages the outermost boundary behind an ordinary subspace
> signature. By space boundary opacity (I8) the parent cannot tell a
> black hole from a regular subspace with the same ports, so
> composition, mocking, and dialect confinement work unchanged. The
> rejected alternative -- ports that go live on any subspace that
> declares an effectful flavour -- would break compose-to-test: a
> space's ports could reach the real world even when the space was
> loaded under a parent for mocking (P-effectlocal, P-handlersub).

---

## Edit 3 — Astroglot grammar (§3, line 520)

Replace the `space_def` rule:

```
space_def    ::= space_label NL (indent property NL)*
                                        -- label at column 0 declares a space
space_label  ::= name                   -- ordinary space
               | '((' name '))'         -- black hole [spacesyn-blackhole]
```

Add after the "Subspaces are referenced..." paragraph (line 598):

> **Black holes** are declared by wrapping the label in double
> parentheses: `((relay))` [spacesyn-blackhole]. The parentheses
> appear only at the definition site; wire endpoints and all other
> references use the bare name [blackhole-ref-bare]. See section 4,
> "Black holes".

---

## Edit 4 — Borks (§3, list at line 697)

Add a category:

>   Black hole violations:
>   - A black hole port whose flavour direction does not oppose the
>     port direction [blackhole-flavour-oppose]
>   - A black hole port with dir `up` or `down` (not yet supported)
>     [blackhole-inout-only]
>   - A black hole definition containing a station, wire, or state
>     declaration [blackhole-only-ports]
>   - The root space declared as a black hole [blackhole-not-root]

---

## Edit 4b — Spaceseed record (§3, spaceseed at line 736)

Add a field to the spaceseed record:

```
spaceseed = {
  ...
  blackhole      : bool            -- true for a black hole [blackhole-seed-flag]
}
```

> A spaceseed compiled from a `((label))` definition has
> `blackhole = true` (default false). This is the only structural
> difference in the compiled form; a black hole's `stations`,
> `state`, and interior `subspaces` are empty [blackhole-no-interior].
> When `blackhole` is true, each port's world-facing flavour methods
> bind to the port's inside face rather than its outside (Edit 6).
>
> This is not a new mechanism. It is the same boundary duality that
> already governs `up`/`down` -- a port's role reverses at the
> boundary -- now applied to the `in`/`out` axis. Round-trip ports
> flip north/south (Enter-N-Exit ⇄ Exit-N-Reenter); a black hole's
> one-way ports flip east/west (Entrance ⇄ Exit of the runtime).
> Nothing is inverted at runtime; the boundary simply sits on the
> other face.

---

## Edit 5 — New section: Black holes (§4, insert after "Outer spaces",
before "Port flavours", line 1244)

> ### Black holes
>
> A **black hole** is a subspace with the real world inside. An outer
> space has Daimio on the inside and the world on the outside; a black
> hole is the same boundary folded inward -- the world on the inside,
> Daimio on the outside. Ships that enter a black hole's in-ports
> leave the runtime. Ships sent back by the external application
> emerge from its out-ports into the parent's wiring.
>
> A black hole is declared by wrapping its label in double
> parentheses [spacesyn-blackhole]:
>
> ```
> ((relay))
>   @in:feed   websock-out
>   @out:news  websock-in
>
> main
>   @in:init     from-js
>   @out:display dom-set-text
>   @in:init -> relay@in:feed
>   relay@out:news -> @out:display
> ```
>
> A black hole declares only ports. A station, wire, or state
> declaration inside a black hole definition borks
> [blackhole-only-ports] -- there is no inside to put it in.
> References use the bare name [blackhole-ref-bare], and
> definition-before-reference applies unchanged
> [spacesyn-subspace-before-ref].
>
> **Ports mirror the outer space.** An outer space has the world
> outside, so each port's flavour matches its direction: `@in` takes
> an in-flavour that brings ships from the world (`dom-on-click`,
> `websock-in`), `@out` takes an out-flavour that emits to the world
> (`dom-set-text`, `websock-out`). A black hole has the world
> *inside*, so it is the mirror -- each port takes the flavour of the
> **opposite** direction. Read `@in:feed websock-out` as: the parent
> sends a ship in, and because the world is inside, it leaves the
> runtime. Read `@out:news websock-in` as: the world produces a value
> that comes out to the parent. The port names stay parent-relative,
> so the parent wires a black hole exactly like any other subspace;
> only the flavour is mirrored. A port whose flavour direction does
> not oppose its port direction borks [blackhole-flavour-oppose]; a
> bare port with no flavour takes the generic flavour of the opposing
> direction [blackhole-default-flavour] -- a bare `@in` is a pure sink.
>
> **Crossing.** There is no interior to route through, so a black
> hole port runs its flavour's world-facing action directly. A ship
> arriving at `@in:feed` is emitted to the world and gone --
> fire-and-forget, no response, no delivery guarantee
> [blackhole-in-exit][blackhole-no-guarantee]; the destination is the
> flavour's own concern (a `websock-out` emits on its configured
> channel), and nothing is added to the ship. A value arriving from
> the world at `@out:news` becomes a ship that exits into the parent's
> wiring, queuing like any external arrival [blackhole-out-enter].
>
> **Sender.** A black hole is treated exactly like the outermost
> boundary: the App attaches the sender to an emerging ship, and
> Daimio trusts it without authenticating (§4 Senders)
> [blackhole-sender-outer]. The App interposes between the black hole
> and the external app and attenuates the sender's dialect as it sees
> fit -- the same mechanism, and the same responsibility, as at the
> outer edge.
>
> **No correlation.** A black hole's in and out streams are
> independent [blackhole-uncorrelated]. Nothing pairs an entering
> ship with an emerging one; request/response across a hole is not
> part of this model. Black holes declare only in- and out-ports;
> `up` and `down` ports on a black hole are not yet supported and
> bork [blackhole-inout-only].
>
> **Opacity.** By space boundary opacity (I8), a black hole is
> indistinguishable from an ordinary subspace with the same port
> signature [blackhole-substitutable]. To test a space that wires
> to a black hole, substitute a regular subspace with the same
> ports; to put an external service behind an existing signature,
> do the reverse. Values crossing the boundary follow the same
> rules as the outermost boundary -- a black hole IS the outermost
> boundary, relocated.
>
> **Nothing inside.** A black hole has no stations, no state store,
> no interior queue, and no processes [blackhole-no-interior]. It
> raises the genus of the Daimio surface without adding interior
> semantics.

---

## Edit 6 — Port lifecycle (§4, "Creation" list at line 1268)

Add a fourth creation case:

>   4. **Black hole ports**: the parent creates and pairs the outside
>      port as for any subspace port, but the flavour's world-facing
>      methods bind to the **inside** face -- at a black hole the
>      inside face is the runtime boundary. `outside_add()` runs there
>      at instantiation, and a ship reaching that face is emitted to
>      the world rather than forwarded to the paired port
>      [blackhole-flavour-inside].

---

## New assertion IDs (16)

spacesyn-blackhole, blackhole-ref-bare, blackhole-only-ports,
blackhole-flavour-oppose, blackhole-default-flavour, blackhole-inout-only,
blackhole-not-root, blackhole-in-exit, blackhole-no-guarantee,
blackhole-seed-flag, blackhole-out-enter, blackhole-sender-outer,
blackhole-uncorrelated, blackhole-substitutable, blackhole-no-interior,
blackhole-flavour-inside
