# Sender Attachment + Deterministic Identity (QNames) — draft edits for D2-spec.md

Drafted 2026-07-05 from design/gen2.md (reviewer finding #5: sender
attachment unspecified; decisions: uniform entry rule, qualified names,
and — per user direction — the full deterministic-ids-everywhere
approach in one patch). Eight edits, ordered by spec position. Line
numbers refer to the current D2-spec.md. New assertion IDs: five
`sender-*`, six identity (11 total).

The two-sentence version: a ship entering a port takes that port's
qualified name as its sender unless it already has one — identity from
topology, authority from the App's sender registry. And every
identifier the runtime can emit observably is a deterministic function
of source topology and execution inputs.

---

## Edit 1 — §1: I3 addition, new I16, P-portable amendment

**I3 (line ~331)** — add after "...down-port requests, and error
ships.":

> A ship that has no sender acquires one at the first port it
> enters (§4, "Sender attachment at entry" [sender-attach-entry]);
> from then on, preservation applies.

**New invariant I16** (append to the invariants list):

> **I16. Deterministic identity.** Every identifier that reaches an
> observable surface — sender ids, error ship contents, ships
> exiting a runtime boundary — is a deterministic function of the
> source topology and the execution inputs (ship arrivals, effect
> responses, PRNG seed). Runtime-generated handles are
> implementation-internal and never observable [id-deterministic].

**P-portable (§1, ~line 292)** — add at the end of the section:

> Deterministic identity (I16) extends this from "same requests" to
> "same bytes": two runs with identical topology and inputs produce
> byte-identical observable output, identifiers included.

---

## Edit 2 — Identifiers rewritten (§4, lines 848–853)

Replace the Identifiers block and add prose:

```
x in PVar       -- pipeline variable names (_foo, _bar)
s in SVar       -- space variable names ($foo, $bar)
c in Cmd        -- command identifiers: c.handler and c.method
q in QName      -- qualified names: spaces, stations, ports [qname-structure]
pr in ProcessId -- process ids: space qname '#' sequence [procid-sequence]
```

> **Qualified names.** Every space, station, and port has a
> qualified name derived from the source topology alone
> [qname-structure]. A space's qualified name is its path of
> subspace names from the outer root, `/`-separated. A station
> appends its name to its space's path. A port appends the §3
> endpoint syntax:
>
> ```
> game/player1              -- a space (player1, subspace of game)
> game/player1/splitter     -- a station in that space
> game/player1@out:move     -- a port on that space
> game/player1/splitter@left -- a named port on that station
> @in:init                  -- a port on the outer space itself
> ```
>
> Uniqueness follows from existing rules: subspace names are unique
> per parent, station names cannot collide with subspace names,
> port names are unique per space, and bare vs named ports are
> distinct [port-bare-named-coexist]. Anonymous inline stations are
> named `s1`, `s2`, ... in source order [qname-anon-station].
> Qualified names are scoped to one outer space; the App
> disambiguates between outer spaces externally [outer-independent].
>
> **Process ids.** Each space keeps a process sequence. Every
> process created in the space — docked ships and sub-processes
> alike — takes the next number: `game/player1#42`
> [procid-sequence]. Under serial execution and depth-first
> sub-process evaluation, the sequence is deterministic given the
> same inputs.
>
> **Content-addressed ids.** Spaceseed ids and block ids are
> content hashes — deterministic by construction [id-content-hash].
>
> **Runtime handles.** Implementations may use internal handles
> (counters, pointers) for ports, processes, and ships. Handles are
> never observable [id-internal-handles]; anywhere an identifier
> appears on an observable surface, it is a qualified name, a
> process id, or a content hash (I16).

---

## Edit 3 — Sender attachment at entry (§4 Senders, insert after the
[sender-effective-default] paragraph, line ~1008)

> **Sender attachment at entry.** A ship entering a port that has no
> sender takes the port's qualified name as its sender id
> [sender-attach-entry]. If the App has registered a sender under
> that id, the ship carries the registered sender (that id, that
> dialect) [sender-attach-registry]; otherwise the sender is the
> qualified name with the space's base dialect -- behaviorally
> identical to today, but attributed. A ship that already has a
> sender is unaffected; attachment never overrides propagation
> [sender-attach-no-override].
>
> Identity therefore binds at the first port a ship enters. For a
> ship from the outside world, that is the boundary port -- a
> `websock-in` port, a `dom-on-click` port, a black hole out-port.
> To confine an entry point, the App registers a sender under its
> qualified name with an attenuated dialect; every ship entering
> there is then dialect-confined at dock, with no cooperation
> required from the flavour or the payload.
>
> Because every ship acquires a sender at first entry, a ship
> without a sender is internal by construction -- the case
> [sender-effective-default] was designed for.

Also amend the [sender-effective-default] parenthetical (line 1008)
from "(the default case for internal routing, system events, etc.)" to:

> (internal-only by construction: a ship acquires a sender at the
> first port it enters [sender-attach-entry])

---

## Edit 4 — Carrier, not payload (§4 Senders, replace the trust
paragraph at lines 1020–1024)

> The sender is how the App tracks which external entity triggered a
> computation. Daimio does not authenticate senders -- the App is
> responsible for validating identity before registering senders and
> passing ships in. From Daimio's perspective, the sender is trusted
> metadata.
>
> Identity rides the carrier, never the payload
> [sender-carrier-not-payload]. A payload field that claims an
> identity (`__in.user`) is data like any other -- stations MUST NOT
> derive privilege from it. The only identity a ship has is its
> sender, bound at entry or attached by the App; a forged identity
> claim inside a packet is inert (§13, "Sender spoofing").

---

## Edit 5 — Flavour ship flow (§4, "Ship flow" at line 1447)

Add after the `enter(ship)` bullet:

> Sender attachment happens at `enter()` [sender-attach-entry],
> before routing or queueing, so the effective dialect is known by
> dock time. A flavour MAY attach a more specific sender before
> entry -- mapped from transport identity (a websock flavour
> resolving a session to an App-registered user sender) or passed
> by the App (`from-js` accepts an explicit sender)
> [sender-flavour-supply]. Flavours derive senders from transport
> metadata or App input only -- never from packet contents
> [sender-carrier-not-payload].

---

## Edit 6 — Black hole sender (§4 Black holes, "Crossing inward"
paragraph)

Replace "Emerging ships carry the black hole space's identity as
their sender [blackhole-sender-identity]" with:

> Emerging ships acquire their sender at the out-port they enter
> through, per the general entry rule: the port's qualified name
> (e.g. `relay@out:news`) [blackhole-sender-identity]
> [sender-attach-entry]. This is port-level attribution; the path
> contains the space name, so space-level policy is the coarse case
> (register the same sender for each of the hole's out-ports).

---

## Edit 7 — Error ship format (§12, line 3988)

Replace the paragraph:

> **Error ship format.** The error ship's value is a string
> describing the error. Any identifiers in that string are
> qualified names or process ids -- never runtime handles (I16).
> The ship carries the process's sender (if any), so the receiver
> can identify who triggered it. Given identical topology and
> inputs, error ships are byte-identical [id-deterministic].

---

## Edit 8 — §13 Sender spoofing (lines 4119–4132)

Replace the Defense and Mitigation paragraphs:

> **Defense:** Identity binds structurally. A ship's sender is
> attached at its entry port [sender-attach-entry] or provided by
> the App; payload identity claims are inert data
> [sender-carrier-not-payload]. A malicious packet through a
> `websock-in` port cannot name its own sender -- it gets the
> port's identity (and the App-registered dialect for that port),
> or whatever sender the flavour resolved from *transport* identity.
> Daimio still does not authenticate senders: validating that a
> transport session belongs to a user remains the App's
> responsibility. If the App's authentication is broken, dialect
> confinement is bypassed for the identities it vouches for.
>
> **Mitigation:** Register attenuated senders for every
> world-facing entry port, so even unauthenticated traffic is
> confined by default. The sender authentication mechanism
> (section 14) would add cryptographic verification at the outer
> space boundary.

---

## New assertion IDs (11)

sender-attach-entry, sender-attach-registry, sender-attach-no-override,
sender-flavour-supply, sender-carrier-not-payload,
qname-structure, qname-anon-station, procid-sequence,
id-content-hash, id-internal-handles, id-deterministic

## Test material

- Entry attribution: a senderless ship through `@in:x` docks with
  sender id `@in:x` and base dialect [sender-attach-entry].
- Registry attenuation: register `@in:x` with a dialect lacking
  `math`; `{3 | math add value 2}` through `@in:x` sploots
  [sender-attach-registry] [dialect-cmd-sploot].
- No override: a ship with sender `alice` entering `relay@in:feed`
  keeps `alice` [sender-attach-no-override].
- Black hole: emerging ship carries `relay@out:news`
  [blackhole-sender-identity].
- Payload inertness: a packet with `{user: "admin"}` through
  `websock-in` gains no privilege [sender-carrier-not-payload].
- Determinism: run the same space twice with the same inputs;
  error ships and exiting sender ids are byte-identical
  [id-deterministic] [procid-sequence].
- Anon naming: two anonymous stations in one space render as
  `s1`, `s2` in source order across runs [qname-anon-station].

## Implementation follow-ups (not spec work)

- Thread qname computation through Space/Station/Port creation
  (each already knows parent + name; layout engine's stable-naming
  is prior art).
- Per-space process sequence replaces the global
  `D.Etc.process_counter` on observable surfaces.
- Audit observable-id leak sites: error message strings, `to-js`
  payloads, REPL output, `{sender}` carriers.
