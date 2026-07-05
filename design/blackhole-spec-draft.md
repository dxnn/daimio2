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
>   - A black hole port with dir `up` or `down` [blackhole-inout-only]
>   - The root space declared as a black hole [blackhole-not-root]

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
>   @in:feed   socket-out
>   @out:news  socket-in
>
> main
>   @in:init     from-js
>   @out:display dom-set-text
>   @in:init -> relay@in:feed
>   relay@out:news -> @out:display
> ```
>
> A black hole declares only ports. Stations, wires, and state
> declarations inside a black hole definition are parsed and
> discarded [blackhole-ignore-structure] -- there is no inside to
> put them in. References use the bare name [blackhole-ref-bare],
> and definition-before-reference applies unchanged
> [spacesyn-subspace-before-ref].
>
> **Two boundaries, two directions.** A port's dir is
> parent-relative: which way ships flow between this space and its
> parent. A flavour's dir is boundary-relative: `in` means ships
> enter the runtime, `out` means ships leave it. At an outer space
> the two coincide, which is why the distinction is invisible there.
> At a black hole they oppose: ships flowing in from the parent (port
> dir `in`) are leaving the runtime (flavour dir `out`). Nothing is
> inverted -- the two directions measure different boundaries. A
> black hole port whose flavour direction does not oppose its port
> direction borks [blackhole-flavour-oppose]. A black hole port
> declared without a flavour defaults to the generic flavour of the
> opposing direction [blackhole-default-flavour] -- a bare `@in` on
> a black hole is a pure sink.
>
> **Ordinary flavours.** There are no black-hole-specific port
> flavours; the universal flavour pool applies. A socket-backed
> black hole needs nothing new: its in-ports carry `socket-out`,
> its out-ports carry `socket-in`.
>
> **Crossing outward.** When a ship enters a black hole's in-port,
> the flavour's real-world exit executes and the ship leaves the
> runtime [blackhole-in-exit]. The crossing is fire-and-forget: no
> response, no delivery guarantee -- if nothing is listening, the
> ship is gone [blackhole-no-guarantee]. Ships crossing outward are
> stamped with the black hole's space identifier and the port name;
> the outer application dispatches on this metadata
> [blackhole-ship-stamp].
>
> **Crossing inward.** When the flavour's real-world connection
> produces a value, a ship is created at the corresponding out-port
> and exits into the parent's wiring, queueing like any ship
> arriving from outside [blackhole-out-enter]. Emerging ships carry
> the black hole space's identity as their sender
> [blackhole-sender-identity]; the effective dialect follows the
> normal sender rules (§4 Senders), so a black hole cannot exceed
> its host's permissions (P-compose).
>
> **No correlation.** A black hole's in and out streams are
> independent [blackhole-uncorrelated]. Nothing pairs an entering
> ship with an emerging one; request/response across a hole is not
> part of this model. Black holes declare only in- and out-ports --
> `up` and `down` ports on a black hole bork [blackhole-inout-only].
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

## Edit 6 — Port lifecycle (§4, "Creation" list at line 1268 and
"Ship flow" at line 1282)

Add a fourth creation case:

>   4. **Black hole ports**: the parent creates and pairs the outside
>      port as for any subspace port. The flavour's real-world
>      methods run on the **inside** port -- at a black hole the
>      inside face touches the runtime boundary -- so `outside_add()`
>      is called there at instantiation [blackhole-flavour-inside].

Add one sentence after the Ship flow bullets:

> At a black hole, the real-world methods (`outside_add`,
> `outside_exit`) run at the inside face rather than the outside:
> the flavour's world-facing end sits wherever the runtime boundary
> is [blackhole-flavour-inside].

---

## New assertion IDs (16)

spacesyn-blackhole, blackhole-ref-bare, blackhole-ignore-structure,
blackhole-flavour-oppose, blackhole-default-flavour, blackhole-inout-only,
blackhole-not-root, blackhole-in-exit, blackhole-no-guarantee,
blackhole-ship-stamp, blackhole-out-enter, blackhole-sender-identity,
blackhole-uncorrelated, blackhole-substitutable, blackhole-no-interior,
blackhole-flavour-inside
