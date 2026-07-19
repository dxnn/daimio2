# Spec patch batch — 2026-07-19 (DRAFT, unapplied)

Six threads, all ruled by dann this session, drafted as concrete edits to
D2-spec.md. Ordered by spec section for application. Anchors are quoted
prose + assertion IDs; exact old_string is re-read at apply time. New
assertion IDs proposed here are subject to dann's approval.

Threads: (A) black-hole metadata + formation manifest; (B) station/subspace
name-collision bork; (C) lexical-chain scoping + socket barrier; (D) state
definition-references (`$src worker_v2`); (E) §8 anon inlining; (F) §8
serialization additions. Engine work for all of it is queued in CLAUDE.md
("Implementation queue") and follows red guides AFTER these patches land.

---

## Patch 1 — §3 grammar: dialect_decl comment gains the hole carve-out

ANCHOR: the `dialect_decl ::= '{' json_object '}'` production (~L702-706).

REPLACE the production's comment block with:

```
dialect_decl ::= '{' json_object '}'   -- outer space only [spacesyn-dialect]
                                       -- e.g. {"blocked_methods":{"process":["unquote"]}}
                                       -- restricts the instance dialect (AND);
                                       -- in a subspace: soft error, ignored
                                       -- [dialect-outer-only]; in a black hole
                                       -- the object is METADATA, not a dialect
                                       -- declaration ([blackhole-meta], §4);
                                       -- invalid JSON borks, everywhere
```

(The "bad JSON borks" rule is already spec'd for dialect_decl; "everywhere"
extends it to the metadata reading. Engine today silently swallows —
alignment is on the implementation queue.)

## Patch 2 — §3 prose: dialect-declaration paragraph, same carve-out

ANCHOR: "A space body may contain a single JSON object literal declaring
dialect restrictions…" (~L760-767).

APPEND to that paragraph:

> In a black hole definition the JSON object is not a dialect declaration
> at all: it is the hole's metadata, delivered to the App at formation
> ([blackhole-meta], §4).

## Patch 3 — §3: line-initial `{` disambiguation

ANCHOR: near the endpoint grammar that admits `'{' daml '}'` as a wire
endpoint (~L718).

ADD one sentence:

> A body-level line is a JSON declaration (dialect or metadata) only when
> it parses as a single JSON object; otherwise a line beginning with `{`
> is a wire whose first endpoint is an inline anonymous station
> [spacesyn-json-vs-wire].

(Names the rule the engine's line-initial-`{` fix will implement — today
`{x} -> A` is silently eaten as a failed dialect parse.)

## Patch 4 — §3: scoping rewrite (lexical chain + socket barrier)

ANCHOR: the scoping paragraph "…Names defined in ENCLOSING spaces are not
visible — a space can never reference its parent's other children…"
(~L750-758), which carries [spacesyn-scope-two-layer],
[spacesyn-shadow-local], [spacesyn-outer-root].

REPLACE the paragraph with:

> Names resolve against the **lexical chain**: a reference may name any
> definition that is already **complete** (its indented body has ended) at
> the point of reference, in the referencing space's own body or in any
> enclosing body, innermost first [spacesyn-scope-chain]. A nested name
> shadows an outer name within the exact space that defines it
> [spacesyn-shadow-local]; a collision is shadowing, never a merge.
> Ancestors are never referenceable — an enclosing definition is not
> complete from inside itself — so no space can include itself; and since
> a referenced definition completed strictly earlier in the source,
> references are well-founded by source position alone.
> **Sockets are scope barriers**: inside a `!name` definition the chain
> roots at the socket — nothing outside the socket's own subtree is
> referenceable [socket-scope-barrier]. A socket's content therefore
> always serializes to a self-contained payload (§8), and its initial
> inline content obeys the same law as every payload later loaded into it.
> The space named `outer` (if present) is the root; otherwise the last
> top-level space defined [spacesyn-outer-root] — a nested definition is
> never root.

RETIREMENT: [spacesyn-scope-two-layer] is superseded by
[spacesyn-scope-chain]. Test/engine references to the old ID (engine
comment at 1_daimio.js:4160, any test labels) get updated in the
implementation pass. NOTE for the corpus sweep: the barrier NARROWS scope
inside sockets (a socket body referencing a top-level definition borks
after this change — legal today).

## Patch 5 — §3: state_decl gains the definition-reference form

ANCHOR: `state_decl ::= '$' name (WS json_value)?` (~L695) and its prose.

REPLACE the production with:

```
state_decl ::= '$' name (WS (json_value | name))?
                                      -- json_value: initial value, as today
                                      -- name: definition reference [state-ref]
                                      -- JSON wins: true/false/null are JSON,
                                      -- so definitions with those names
                                      -- cannot be source-referenced
                                      -- unresolved name borks
                                      -- [state-ref-unresolved-bork]; a value
                                      -- that is neither valid JSON nor a
                                      -- visible name borks
```

ADD a prose paragraph after the state-declaration prose:

> **Definition references.** `$src worker_v2` initializes `$src` with the
> canonical Astroglot source (§8) of the definition `worker_v2`, resolved
> in the lexical chain [spacesyn-scope-chain] at parse time [state-ref].
> The reference is parse-time only: every compile re-resolves it, so
> editing the definition updates every capture — but at instantiation the
> svar holds an ordinary string, and nothing tracks the definition
> afterward. In particular, referencing a socket (`!name`) definition
> captures the definition as written in source; the svar DOES NOT change
> when that socket is later reloaded [state-ref-parse-time].
> Serialization flattens: the svar serializes as its current string value,
> and the reference does not survive (§8) [state-ref-serialize-flat]. The
> chief use is socket reloading: capture a definition, then send it to a
> socket-load port-like — `{$src | >worker@socket-load}` — the same
> source every time, however often the file's definitions evolve between
> compiles.

## Patch 6 — §3 bork catalog: three additions

ANCHOR: the compile-bork list (~L915, beside "A black hole definition
containing a station, wire, or state declaration [blackhole-only-ports]").

ADD:

> - A station and a subspace sharing a name in one space body
>   [spacesyn-name-collision]. (Without this, the engine silently
>   shadowed: the subspace won the name and the station was orphaned.)
> - An unresolved definition reference in a state declaration
>   [state-ref-unresolved-bork].
> - Invalid JSON in a dialect declaration or a black hole's metadata
>   object — restates [spacesyn-dialect]'s existing rule and extends it
>   to metadata.

## Patch 7 — §4 Black holes: Metadata + Formation paragraphs

ANCHOR: insert after the **Sender** paragraph (ends "…register the same
sender for each of the hole's out-ports.", ~L1626), before
**No correlation**.

INSERT:

> **Metadata.** A black hole's body may contain a single JSON object
> literal: the hole's **metadata**, an opaque value delivered to the App
> in the formation manifest (below) [blackhole-meta]. Daimio never
> interprets it. Metadata is the hole's wrap-stable identity: qualified
> names are root-relative paths that change when a space is wrapped
> inside another, but metadata rides the definition, so the App can
> dispatch on what a hole IS rather than where it currently sits. Read it
> as a capability request: the definition asks for a binding; the App
> decides what, if anything, to grant. Declining is safe — an unbound
> hole is inert (in-ports swallow [blackhole-no-guarantee], out-ports
> never fire). A second JSON object in the same body borks; invalid JSON
> borks. Metadata is part of the definition and survives serialization
> [serialize-keeps-hole-meta] (§8).
>
> **Formation.** When a black hole is instantiated — with its containing
> space, or inside content arriving through a socket load — the runtime
> notifies the App with the hole's **manifest**: its qualified name, its
> name, its ports (each with name, direction, flavour, and settings), and
> its metadata [blackhole-manifest]. The notification is synchronous,
> during construction, before any ship docks in the newly constructed
> content. When one construction creates several holes, manifests fire in
> source order (declaration order, depth-first through subspaces),
> matching [qname-structure] [blackhole-manifest-order]. When a hole is
> destroyed — its containing content replaced by a socket transition —
> the App is notified at the transition's commit point, in the same order
> [blackhole-teardown]. Notifications are outputs to the App, not ships:
> they carry no number, and the rules above fix their positions in the
> observable trace, so a replay reproduces them exactly (I17). A
> notification hook that throws is caught ([flavour-error-soft],
> [host-error-sploot]); it never aborts construction or a socket
> transition and creates no bork path [manifest-hook-soft]. Ships the App
> injects from within a hook enter at the boundary frontier like any
> external arrival and dock only after construction completes
> [manifest-inject-frontier].

## Patch 8 — §4 Opacity: observer qualifier

ANCHOR: "**Opacity.** By space boundary opacity (I8), a black hole is
indistinguishable from an ordinary subspace with the same port signature
[blackhole-substitutable]…" (~L1635-1642).

REPLACE the first sentence and add a parenthetical:

> **Opacity.** By space boundary opacity (I8), a black hole is
> indistinguishable to the parent — and to every space in the topology —
> from an ordinary subspace with the same port signature
> [blackhole-substitutable]. (The App is not such an observer: it
> supplies the hole's flavours, receives its world traffic (I10), and is
> notified of its formation ([blackhole-manifest]); opacity governs the
> DAML-level view.) To test a space that wires to a black hole, …
> [rest unchanged]

## Patch 9 — §4 App obligations: the binding bullet

ANCHOR: the App obligations list (~L1793-1821), after the sender bullet.

ADD:

> - **Bind black holes via their manifests.** The App learns of every
>   hole at formation ([blackhole-manifest]) and grants or refuses the
>   binding its metadata requests ([blackhole-meta]): supplying function
>   and channel targets for the hole's flavours, and registering
>   attenuated senders under its out-port qualified names
>   ([sender-attach-registry]) — re-registering at each formation, since
>   qualified names shift when topology is rewrapped. Declining to bind
>   is safe: an unbound hole is inert.

## Patch 10 — §8: metadata survives; state references flatten

ANCHOR: the "A serialized space does NOT include:" list and the
[serialize-keeps-dialect-decl] parenthetical (~L2801-2805).

ADD beside the dialect parenthetical:

> A black hole's metadata is part of the definition and IS serialized
> [serialize-keeps-hole-meta].

ADD to the does-NOT-include list:

> - Definition references in state declarations — a reference-initialized
>   space variable serializes as its current string value; the reference
>   itself does not survive [state-ref-serialize-flat].

## Patch 11 — §8: anonymous stations serialize inline

ANCHOR: the canonical-serialization paragraph (~L2791-2799, "Space syntax
is the canonical serialization format…").

ADD:

> Anonymous stations serialize **inline**, in the wire chains where they
> occur — `@in -> {x} -> @out` — never as named declarations
> [serialize-anon-inline]. Emission preserves their source order, so
> their runtime names ([qname-anon-station]) are stable across a
> serialize and reload. Runtime names (`s1`, `s2`, …) exist for error
> attribution only; they never appear in serialized output.

(Fixes two live defects of the current scheme: `station_name` mints
generated names without skipping user-taken ones — a declared `s1` plus
one anon serializes both as `s1` and the reparse clobbers — and any
reparse converts anons into declared stations, destroying anonymity.)

---

## Not in this batch (tracked elsewhere)

- Engine alignment (all on CLAUDE.md's implementation queue): JSON borks,
  line-initial-`{` fix, collision bork, chain-walk resolver + socket
  barrier, state-ref resolution, serialize inlining, seed.meta plumbing,
  manifest hook.
- The render-stack reflection contract (design/topology-contract.md) —
  consumes these rules, adds none.
- [blackhole-flavour-inside] instantiation-half REVISIT (TEST_TODO.md).
- Divergence (b) — subspace dialect soft-error keyed on blocked_methods —
  engine alignment, no spec change.

## New assertion IDs proposed (dann approves)

[blackhole-meta] [blackhole-manifest] [blackhole-manifest-order]
[blackhole-teardown] [manifest-hook-soft] [manifest-inject-frontier]
[serialize-keeps-hole-meta] [spacesyn-name-collision]
[spacesyn-json-vs-wire] [spacesyn-scope-chain] (retires
[spacesyn-scope-two-layer]) [socket-scope-barrier] [state-ref]
[state-ref-parse-time] [state-ref-unresolved-bork]
[state-ref-serialize-flat] [serialize-anon-inline]
