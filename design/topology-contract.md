# Topology: the public contract of the layout/render stack

Status: DRAFT v0 (2026-07-19). dann ruled that the topology shape is THE
public input contract for the viz stack; the parser seedlike is private
to the core. This document pins the shape as it exists today, names the
warts to resolve before freezing v1, and states the boundary rules.

## The boundary

```
seedlike ──extract()──▶ topology ──layout()──▶ laid_out ──render()──▶ picture
(private)  (adapter)    (PUBLIC)               (internal)
```

- **Producer**: the core owns `extract(name, seedlike)` — the sanctioned
  adapter from Daimio's parser output to a topology. It currently lives in
  `site/js/space_layout.js`; when the viz stack is extracted into its own
  project, `extract` stays on the CORE side of the boundary (it encodes
  Daimio semantics — see "Adapter behavior" below). Anyone may also
  construct topologies by hand; the unit tests already do.
- **Consumers**: `layout(topology, options)` and, through it, the ASCII
  and SVG renderers. The viz stack reads ONLY what this document names —
  a topology is a plain JSON-serializable object with no engine
  dependencies.
- **Non-goals**: the layout OUTPUT shape (`elements` + paths) is a
  separate interface between `layout` and the renderers ("pluggable
  renderer" seam); it stays internal until someone external needs it.
  The seedlike shape is explicitly NOT public and may change freely.

## The shape

```
Topology = {
  name:        string        -- space name; rendered as the box title
  id:          string        -- currently always === name (wart W1)
  ports:       [Port]        -- the space's own boundary ports
  stations:    [Station]
  subspaces:   [string]      -- referenced space names (wart W2)
  connections: [Connection]
  state:       {svar: json}  -- initial svars; rendered as '$key: value' rows
}

Port = {
  id:      string    -- 'p<i>' by declaration order; unique in this topology
  key:     string    -- the port key: 'in', 'in:init', 'down:svc', or a
                     -- custom name with no direction prefix
  dir:     'left' | 'right' | 'top' | 'bottom'
                     -- geometric wall side: in→left, out→right, up→top,
                     -- down→bottom; custom keys inferred (see adapter)
  flavour: string    -- carried from the declaration; never consumed by
                     -- the viz stack (wart W5)
}

Station = {
  id:     string     -- 's<i>' by declaration order; unique in this topology
  name:   string     -- declared name, or a stable anonymous name
                     -- ('s0','s1',... by source-text rank, skipping names
                     -- taken by declared stations)
  source: string     -- DAML source text; the box label (truncated by
                     -- options.max_source) and the canonical sort key for
                     -- anonymous stations
  ports:  [string]   -- extra port names beyond the implicit _in/_out
}

Connection = {
  id:   string       -- 'c<i>'
  from: Endpoint
  to:   Endpoint
  type: 'faf' | 'contract'
  pair: string?      -- the reverse connection's id when type == 'contract'
}

Endpoint = {
  id:   string       -- a Port.id, a Station.id, or a subspaces[] member
  port: string       -- the port at that node: the port's own key when id
                     -- is a Port.id; '_in'/'_out' or an extraport name on
                     -- a station; the child's port key on a subspace
}
```

## Contract-level invariants

1. **Unique node ids.** Port ids, station ids, and subspace names share
   one id namespace within a topology; no two nodes may collide (today
   this is unenforced — wart W2).
2. **Endpoints resolve.** Every `Endpoint.id` names an existing port,
   station, or subspace. The adapter drops unresolvable routes; `layout`
   never sees dangling endpoints.
3. **Contracts come in linked pairs.** `type == 'contract'` implies a
   partner connection with mirrored node ids and reciprocal `pair`
   fields.
4. **Order independence (canonicality).** The picture is a pure function
   of the SET of nodes and connections — declaration and route order
   must not affect it. This is why anonymous stations carry rank-stable
   names and why `layout` sorts connections by component name before
   doing anything else. Producers may emit arrays in any order.
5. **Closedness.** One topology renders alone. A subspace is an opaque
   labeled box; the ports drawn on it are inferred from the parent's
   connection endpoints that touch it, never from the child's own
   definition. Multi-space output (`render_all`) is N independent
   renders.
6. **JSON-serializable.** A topology contains no functions, no engine
   handles, no cycles. `state` values must survive `JSON.stringify`.

## Adapter behavior (what extract() adds beyond copying)

These transformations encode Daimio semantics and therefore live with
the core, not the viz library:

- **dir from key prefix** (`in:`/`out:`/`up:`/`down:` → wall side); a
  custom-named key gets its side inferred from connection usage
  (appears as a source → left, as a dest → right).
- **Anonymous station naming**: `station-*` placeholders become
  's0','s1',... ranked by source text (declaration order breaks ties),
  skipping names already taken by declared stations.
- **Send scraping**: `>@name` occurrences in a station's DAML source
  are added to its `ports` list (union with declared extraports).
- **Route resolution**: `name.port` endpoint strings resolve to
  `{id, port}`; a station's bare `in`/`out` map to `_in`/`_out`.
- **Contract detection**: a route pair `[A → B.in]` + `[B.out → A]`
  becomes two `type:'contract'` connections linked via `pair`.

## Warts to resolve before freezing v1 (decisions for dann)

- **W1 — `id`/`name` duplication** on the topology root. Drop `id`
  (nothing distinguishes them today).
- **W2 — subspace node identity.** Subspace nodes are identified by the
  *referenced* space's name, used raw as an endpoint id. Consequences:
  (a) a space named `p0`/`s3`/`c1` collides with the generated id
  namespaces; (b) the local slot name is discarded, so two slots
  referencing the same child collapse into one node and cannot be told
  apart; (c) boxes are labeled by referenced-space name, not slot name.
  Proposal: `subspaces: [{id: 'u<i>', slot: <local name>, space: <ref
  name>}]`, endpoints reference the `id`. NOTE: keeping the box LABEL as
  the referenced-space name keeps every existing render byte-identical;
  labeling by slot would change renders (fixture regen — dann's call
  only).
- **W3 — anonymous detection by name pattern.** `layout` re-detects
  anonymous stations with `/^s\d+$/` on `name` for canonical sorting, so
  a user station legitimately *named* `s3` is silently sorted by source
  text instead of name. Proposal: explicit `anon: true` on Station; the
  pattern test goes away.
- **W4 — geometric dir vocabulary.** `left/right/top/bottom` (not
  `in/out/up/down`) is the right vocabulary for a Daimio-agnostic viz
  library, and the ASCII parser already canonicalizes geometry back to
  `@in`/`@out` names. Confirm this is intended, then it's a feature:
  ALL Daimio meaning lives in the adapter.
- **W5 — dead `flavour` field.** Carried on every Port, consumed
  nowhere in the stack (labels and flavours never reach the picture).
  Drop it from the contract, or keep it as an optional
  producer-annotation slot for other consumers (the spaceeditor reads
  flavours from the seedlike directly today, not from topology).

W1/W3/W5 change `extract` + `layout` + the hand-built test topologies in
lockstep but keep every render byte-identical (ids and flags never reach
the picture). W2's identity fix is also render-stable IF the label rule
is kept; only a label-rule change would touch fixtures.

## Versioning

No in-band version field — hand-built topologies in tests shouldn't
carry ceremony. The contract is versioned with the viz library itself
(semver: breaking shape change = major bump), and this document is the
normative reference. Until the viz stack is extracted, this document
alone is the version.
