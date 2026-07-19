# The space reflection: public input contract of the render stack

Status: v1 DIRECTION (2026-07-19, dann's rulings) — supersedes the v0 draft
and its W1–W5 wart list. The shape is provisionally called a **space** ("the
reflection of a space"); "Topology" is retired (it was an internal variable
name promoted without justification). dann names the final term.

## Principle: no new decisions

The render stack's public input is **the JSON reflection of a canonical
Astroglot space definition**. All semantics — naming, vocabulary,
canonicality, what a space contains — are owned by the spec (§3 space
syntax, §8 serialization). This document defines only (a) the JSON encoding
of that surface, and (b) the few DERIVED fields the renderer needs that the
lib cannot compute itself. When this document and the spec disagree, the
spec wins.

Everything downstream — `layout`, its output shape, `render`, the picture —
is the render lib's private business and is deliberately not specified here.

## The boundary

- **Producer**: the core owns the adapter (parser/seed → reflection). It has
  engine state (the flavour registry, the DAML scraper) and encodes all
  Daimio knowledge. The lib never parses Astroglot or DAML.
- **Consumers**: the render lib, and anyone hand-building spaces (tests do).
- A reflected space is plain JSON: no functions, no engine handles, no
  cycles.

## The shape

```
Space = {
  name:      string
  ports:     [Port]            -- the space's own boundary ports
  stations:  [Station]         -- DECLARED stations only; anonymous stations
                               -- live inline in routes (see Endpoint)
  subspaces: [string]          -- slot names; a slot's name IS the referenced
                               -- definition's name (references are bare-name,
                               -- [blackhole-ref-bare]; aliasing inexpressible)
  routes:    [Route]
  state:     {svar: json}      -- initial svars; rendered as '$key: value'
}

Port = {
  name:    string              -- the Astroglot port key: 'in', 'in:init',
                               -- 'down:svc', or a custom name
  dir:     'in'|'out'|'up'|'down'
                               -- DERIVED for custom names: the adapter
                               -- resolves via the key prefix, else the
                               -- flavour registry. Astroglot vocabulary —
                               -- wall geometry is the lib's internal mapping.
  flavour: string              -- kept; part of the port declaration
}

Station = {
  name:   string
  source: string               -- the DAML body
  ports:  [string]             -- DERIVED: ports beyond the implicit _in/_out
                               -- (endpoint-declared extraports ∪ '>@x' sends
                               -- scraped from source — needs DAML knowledge,
                               -- so the adapter computes it)
}

Route = {
  chain:    [Endpoint, ...]    -- 2+ entries; the Astroglot wire chain
                               -- '@in -> {x} -> @out' is ONE route
  kind:     'faf'|'contract'   -- contract = '<->', chain of exactly 2;
                               -- signal-type legality is §3's business
  timeout:  integer?           -- trailing wire timeout, when declared
}

Endpoint =
  { port: string }             -- boundary port ('@in:init')
| { name: string, port?: string }
                               -- station or subspace, optional port —
                               -- unambiguous because component names are
                               -- unique per space (§3 collision bork, below)
| { daml: string }             -- inline anonymous station ('{x}')
```

A source file reflects to a name-keyed collection of Spaces; slots reference
siblings by name. Rendering is per-space (see Closedness).

## Anonymous stations

An anonymous station has NO name, here as in source. Each inline `{…}`
occurrence mints a distinct station (parser fact: fan-in to an anon is
inexpressible in Astroglot), so an anon's identity is its position in its
route chain — nothing else is needed. Renderers draw anons without a name
label. The runtime's `s1`, `s2` qnames ([qname-anon-station], source order)
are runtime identity for error attribution only: they never appear in a
reflected space, a serialized definition, or a picture.

## Invariants

1. **Names resolve.** Every `{name, port?}` endpoint names an existing
   station or subspace; every `{port}` endpoint names a boundary port.
2. **One namespace.** Station and subspace names are unique within a space —
   guaranteed upstream by the §3 collision bork (queued; today the engine
   silently shadows).
3. **Closedness.** One space renders alone. A subspace is an opaque labeled
   box; the ports drawn on it are inferred from the routes touching it.
4. **Order independence.** The picture is a function of the definition's
   content; array order is immaterial. (An anon's identity is positional
   within its own chain, which is content, not array order.)
5. **JSON-serializable throughout.**

## Derived fields (exhaustive)

Only two fields are not a 1:1 reflection of surface syntax: `Station.ports`
(DAML-scraped sends ∪ endpoint-declared extraports) and `Port.dir` for
custom-named ports (flavour-registry lookup). Both require engine knowledge,
which is exactly why the adapter lives core-side.

## Spec edits this contract depends on (queued, approved 2026-07-19)

- **§3**: station/subspace name collision borks at compile
  (today: no error; subspace silently shadows, station orphaned, qname
  ambiguity — probe in tmp/probe_name_collision.mjs).
- **§8**: canonical serialization inlines anonymous stations into their wire
  chains instead of minting generated-name declarations (current scheme is
  buggy: `station_name` doesn't skip user-taken names → name capture on
  reload; reparse converts anons to declared stations). Clause: emission
  preserves anon source order so runtime qnames stay stable across reload.

## Renderer notes (non-normative)

- Round-trip testing equates via canonical Astroglot:
  `serialize(parse(render(S))) == serialize(S)`. Byte-parity with
  hand-written source is a non-goal; the round-trip suite does not dictate
  core internals (dann's ruling).
- Implementation impact when this lands: extract/layout/parse rework
  (names-not-ids, inline anons, dir vocabulary), and regeneration of the
  anon-labeled fixture renders — fixture regen only on dann's explicit go.

## Versioning

No in-band version field. The contract is versioned with the render lib
(semver; breaking shape change = major bump); this document is the normative
reference until the lib is extracted (extraction currently PARKED — see the
viz-extraction design thread).
