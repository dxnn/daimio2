# Audit spec patches (draft — not applied)

2026-07-10. Four patches blessing the spec-behind-impl features from
the coverage audit (extra/coverage/FINDINGS.md §1), per dann's calls
in extra/coverage/DECISIONS.md. Draft only; apply after review.
Each patch gives the insertion point in D2-spec.md and proposed text.

---

## Patch 1: `dialect_decl` production (§3 Grammar)

**Insert into the `property` production** (after `state_decl`):

```
property     ::= port_decl
               | station_decl
               | wire_decl
               | state_decl
               | dialect_decl
```

**Add after the State section of the grammar block:**

```
-- Dialect ------------------------------------------------------

dialect_decl ::= '{' json_object '}'    -- outer space only [spacesyn-dialect]
                                        -- e.g. {"blocked_methods":{"process":["unquote"]}}
                                        -- restricts the instance dialect; a subspace
                                        -- dialect_decl is a soft error [dialect-outer-only]
```

**Add prose after "Implicit port creation":**

> **Dialect declaration.** A space body may contain a single JSON
> object literal declaring dialect restrictions
> (`blocked_methods`, `blocked_aliases`). The restriction is
> intersected with the instance dialect at creation
> (AND logic — a command must survive both). Only the outer space
> may declare one; a dialect_decl in a subspace is a soft error and
> is ignored, preserving dialect monotonicity
> [dialect-inherit-parent] [spacesyn-dialect] [dialect-outer-only].
> Invalid JSON is a bork.

New assertion IDs: `[spacesyn-dialect]`, `[dialect-outer-only]`.
Test touchpoint: fix space_test.mjs:1488's comment, which cites a
production that did not exist; tag :1488/:1507 with the new IDs.

**APPROVED 2026-07-12 with amendment (dann): serialization KEEPS the
declared dialect.** §8 must be amended: the seed-declared dialect
restriction is part of the definition and survives a serialize→reload
round trip [serialize-keeps-dialect-decl]; the App-provided INSTANCE
dialect remains unserialized and is re-established at load (as is
wiring). Two dialect sources, two fates. Test touchpoint: the
space_test known-failure 'serialized space excludes dialect and
wiring' must be rewritten to distinguish the two (declared restriction
present, instance dialect + wiring absent) when serialize lands.

Impl note (already true): seedlikes_from_string's `dialect` action
JSON-parses the block; D.Space intersects via
make_restricted_dialect; subspace declaration soft-errors. The seed
already carries `seed.dialect`, so serialization-keeps-it falls out
of emitting the seed faithfully.

---

## Patch 2: Space label sigils + nested definitions + lexical scope (§3, §4, §8)

REWRITTEN 2026-07-12 per dann's design (supersedes the structural-
inference draft), APPROVED same day: `+` confirmed over `-` (`-`
reads too close to `->` wires and in-name hyphens), both bork
directions confirmed (sigil at top level borks; bare nested block
containing structure borks). Nested definitions are marked by a
**sigil on the label**, one per space kind; classification is never
inferred from the block's body.

```
+inner    -- nested subspace definition            [spacesyn-subspace-nested]
*inner    -- black hole (replaces ((inner)))       [spacesyn-blackhole]
!inner    -- socket (subspace with a permanent
             socket-load frame; see §8 changes)    [spacesyn-socket]
```

**Grammar:**

```
space_label  ::= name                   -- top level only: ordinary space
               | '*' name               -- black hole [spacesyn-blackhole]

property     ::= port_decl
               | station_decl
               | wire_decl
               | state_decl
               | dialect_decl
               | subspace_def

subspace_def ::= subspace_sigil name NL (indent+ property NL)+
                                        -- nested definition; recursive
                                        -- [spacesyn-subspace-nested]
subspace_sigil ::= '+' | '*' | '!'      -- subspace | black hole | socket
```

**Placement rules (borks):**
- A sigil is REQUIRED on nested definitions and FORBIDDEN at top
  level for `+` and `!` — a `+`/`!` label at column 0 borks, and a
  bare nested block whose body contains space structure (port/state
  decl or wire) borks [spacesyn-sigil-required]. This is the rule
  that turns indentation slips into compile errors instead of silent
  topology changes: a bare indented name is ALWAYS a station, and a
  station body containing structure is an error, never a reparse.
- `*` (black hole) is legal at top level (a shared sibling
  definition, referenced by bare name [blackhole-ref-bare]) and
  nested. `!` is nested-only: socketness is a property of the slot
  in a parent, so a socket has nowhere to exist except nested
  ([socket-load-not-root] generalizes).
- [spacesyn-outer-root] unchanged: `outer` (or the last top-level
  space) is root; nested definitions are never root.

**Scoping (lexical, two layers, no parent refs):**
- Inside a space's body, an endpoint name resolves to: (1) a
  sigil-defined subspace of THIS space, else (2) a top-level space
  defined earlier in the file [spacesyn-subspace-before-ref]. Names
  defined in ENCLOSING spaces are NOT visible — a child cannot
  reference its parent's other children or any ancestor
  [spacesyn-scope-two-layer]. A nested name shadows a same-named
  top-level space only within the exact space that defines it
  [spacesyn-shadow-local].
- Rationale: keeps definitions well-founded — with before-ref
  ordering at top level and no upward references, a space can never
  include itself (the original reason for flat definitions), while
  still allowing local nesting.
- A same-name collision is shadowing, never a merge: the current
  impl MERGES a nested definition into a same-named earlier seedlike
  (probed 2026-07-10) — that behavior dies with this patch.
- Serialization consequence (accepted): serialized form is lexical
  (nested), since shadowed names cannot be flattened to siblings
  without renaming. Content-addressing later removes the quirk.

**§8 socket changes (the `!` semantics — implicit port-likes,
dann 2026-07-12):**
- Socket-load receivers are not ports: a port has an inside, and a
  load acts ON the slot rather than entering the space. They are
  **port-likes**, and they are never declared. `!name` implies
  exactly two: `name@socket-load` (drain) and
  `name@socket-load-smash` [socket-portlike-implicit]. The
  socket-load FLAVOUR is removed from the declarable set entirely.
- The names `socket-load` / `socket-load-smash` are reserved in the
  @-position on sockets (like the dir keywords); the endpoint
  grammar gains this form, valid only when the referenced name is a
  `!`-declared socket [socket-portlike-endpoint].
- Port-likes are parent-side only: content has no way to address
  them, so content can never wire its own reload — self-replacement
  is unrepresentable. A space that wants to trigger its own reload
  must ask its parent through an ordinary down-port round trip.
- A socket is ALWAYS reloadable — [socket-load-reloadable] is
  DELETED, and there is no frame/content port split to specify: a
  load replaces ALL declared ports along with stations, wiring,
  state, and sub-subspaces. The frame is just: the name, the parent
  wiring, and the two implicit port-likes.
- Runtime loads never bork — they SPLOOT [socket-load-sploot]:
  invalid Astroglot or any other bad load is lifted to a soft error
  at runtime; current content untouched. Compile-time borks
  unchanged: a bad DEFAULT definition inside `!name` borks.
- Three old rules dissolve into grammar impossibilities: a root
  socket cannot be written (`!` is nested-only; [socket-load-not-root]
  becomes structural), a black-hole socket cannot be written (`*`
  and `!` are mutually exclusive sigils; the declaration side of
  [blackhole-no-socket-load] becomes structural), and loaded content
  declaring socket-load ports is just invalid Astroglot (unknown
  flavour) → the load sploots. The earlier open sub-question is
  dissolved.
- Drain/smash both always available; the PARENT chooses per wire by
  targeting the drain or smash port-like — consistent with the
  slot-ownership model (design decisions §2's per-port rationale is
  preserved, relocated from declared flavour params to the two
  fixed port-likes).

**Black hole marker migration (§3/§4):** `((name))` → `*name`
everywhere. Nearly free: nothing implements `((name))` yet (parser,
extract, layout, renderers, ascii-parse are all black-hole-blind —
gen3 ground truth). Touchpoints: the black-hole compile-bork RED
guides in space_test (4f5830c) and det_blackhole_test reference the
(( )) form; [spacesyn-blackhole] grammar line; [blackhole-ref-bare]
unchanged (references are always the bare name); the bh-render
thread's [idea:bh-box-marker] should echo the NEW source form.

New assertion IDs: [spacesyn-sigil-required], [spacesyn-socket],
[spacesyn-scope-two-layer], [spacesyn-shadow-local],
[socket-portlike-implicit], [socket-portlike-endpoint],
[socket-load-sploot].

Test touchpoints: the provisional [spacesyn-subspace-nested] tag
becomes official (space_test:566/593/617, drop the "TODO.md is the
authority" comments); every nested-form test gains the sigil;
det_socket guides reframe from content-declared to frame-declared
ports; shadowing + sigil-bork + scope tests are new.

---

## Patch 3: `closed` spaces — DROPPED (dann 2026-07-12)

Ruling: the `closed` flag does not carry its own complexity weight.
The scenario it guarded against — the App executing directly inside
a subspace without a sender — should be impossible in the first
place: **an App must not put a ship directly into an interior
space. Ships always enter from the outside: the outer space's
world-paired ports or a black hole's out-port.**

Replacement (one line, not a feature): add that rule explicitly to
§4 "The App's obligations" (it is currently only implied by the
sender-attach bullet's "at the outermost edge or a black hole
out-port alike"):

> - **Enter only at the boundary.** The App injects ships solely
>   through the outer space's world-paired ports and black-hole
>   out-ports. It never addresses an interior space directly — no
>   direct execute/dock into a subspace. [app-entry-outside-only]

New assertion ID: `[app-entry-outside-only]`.

Cleanup this implies (engine/tests):
- Remove the `closed` flag: seed field, `D.Space` copy
  (`this.closed = !!seed.closed`), and the `execute()` guard
  ('Closed space requires a sender').
- Remove/rewrite security_test.mjs:340-359 (the three
  [independent:closed-space] tests); a new guide can assert
  [app-entry-outside-only] once an enforcement point exists (e.g.
  send_value_to_js_port refusing non-root spaces).
- Check other `closed` references before deleting (grep).

---

## Patch 4: `process dialect` / `process aliases` reflection (§13 invariant)

**Amend the §13 invariant bullet (~L4593):**

Current:
> No DAML command creates, modifies, or forges a sender, or exposes
> a sender's dialect. A process may read its own sender's id (…)

Proposed:
> No DAML command creates, modifies, or forges a sender, or exposes
> a sender's dialect beyond the **effective dialect** — which is
> observable by construction (invoking a command reveals, by sploot
> or success, whether the effective dialect contains it). A process
> may read its own sender's id (a read-only, unforgeable string)
> via `{process sender}`, and may reflect its own effective command
> and alias tables via `{process dialect}` and `{process aliases}`
> [process-reflect-effective]. All three are themselves
> dialect-gated, so a restricted dialect can withhold them; they
> reveal the intersection, never the sender's or the space's
> standalone dialect [dialect-not-exposed].

**Add to the process-domain command list (§10/§13 wherever
`process sender`/`unquote`/`run` are enumerated):** `process
dialect` (effective method table, keyed by handler) and `process
aliases` (effective alias table), both reflecting the CURRENT
process's effective dialect.

New assertion IDs: `[process-reflect-effective]`,
`[dialect-not-exposed]` (the sharpened negative).
Test touchpoint: security_test.mjs:735/737/754 get the tags.

Rationale (from DECISIONS.md C4): reflection adds convenience, not
capability — probing already reveals membership one command at a
time. The sharpened invariant states exactly what stays hidden: the
sender's dialect BEYOND the intersection.

**APPROVED 2026-07-12 (dann): option (a), as drafted.** One item of
spec work rides along: the returned TABLE SHAPES become observable
surface and must be pinned (method table keyed by handler; alias
table shape) when the patch is applied.
