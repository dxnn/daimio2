# Round-trip signal flip: port-local design (v2)

2026-07-12. Supersedes the v1 contract-carrier draft after dann's
challenge ("ships are inherently FAF — why does a ship carry a
contract?") dismantled it. v1's ship-carried contract is DELETED.
The model: **ports hold small local state; wires carry ships;
nothing rides on a ship but its value and carrier metadata (sender,
number).**

## Found state (unchanged from v1 — probed, not assumed)

- FAF pass-through of paired up-ports already works (enter on either
  half crosses via pair.exit).
- Down ports are dead for two mundane bugs:
  1. Parser: a mid-chain PORT never becomes the next hop's source
     (1_daimio.js:3572 resets `route = []`); `a -> @down:x -> b`
     silently loses `[down:x → b]`.
  2. The `down` flavour's `exit` (pflavs/internal.js:36) is a dead
     stub that swallows every crossing ship.
  With both fixed (probed via monkeypatch), request legs ride end to
  end; the response legs are ordinary wires and ride the same way.

## The model

**Routing is everything except effectful commands.** A `<->`
contract compiles BOTH legs to real wires. `S@down:ask <-> T@up`:
the request rides wires out of S, across the parent, into T, docks
at T's contracted station; the response is that station's `_out`
riding the response-leg wires back into S and onward. No process
waits; nothing correlates; the "teleport vs re-hop" question from
v1 is dissolved — response legs are wires, and ships ride wires.

**Effectful commands are the only suspension, and the transient cmd
port is the correlation** [cmd-transient] [P-duality]. Each
invocation demand-creates its own port; the resume callback lives ON
the port (port-local state, like a DOM binding). Concurrent
invocations are distinct ports — no pairing ambiguity exists. The
port is destroyed at response or timeout; a later response finds no
port and ghosts by nonexistence. (This is how cmd-to-world already
works: port sync with callback. No change.)

**Declared round-trip ports get one piece of local state:
occupancy.** (dann blessed 2026-07-12)

- A request entering the port marks it OCCUPIED and records the
  return address (normally the static out-wire; for a wiring-rule
  target, the invoking transient cmd port).
- One at a time [port-one-at-a-time]: a request arriving while
  occupied queues AT the port. This is the temporal reading of
  [port-point-to-point] (one wire in, one out, one flight).
- The first ship arriving at the out-side while occupied IS the
  response — ordinal, provenance-blind ("only the first counts",
  [upport-first-response] as written). It exits via the recorded
  return address and clears occupancy.
- A ship arriving at the out-side while NOT occupied is a ghost:
  dropped, soft error in the port's own space
  [upport-ghost-after-first]. (v1 open question 2 — where ghost
  errors surface — resolves itself: the port is one place.)

## Timeout discipline (settled 2026-07-12, second pass)

The first-pass DRAINING design (port holds until its "guaranteed"
response arrives) was WRONG and is dead: the one-response guarantee
fails at the world boundary (answer-or-timeout is an App OBLIGATION,
not a guarantee), under socket smash, and the outside of a
round-trip port is an uncontrolled stream anyway — even after the
planned [port-point-to-point] bork, the single legal response wire
carries unbounded unrelated flow when the contract RHS is a station
(multiplexed _in, self-loops, fans). A port state that waits on an
arrival that may never come is a liveness hole.

**The mechanism: the timeout acts on the PORT, not the process.**
At its deadline (a schedule clock event, [sched-timeout-event]) an
occupied port EMITS the empty response onward itself and frees. The
waiting process sploots because it RECEIVES that empty — one
mechanism, not two ([timeout-resume-empty] falls out). One-out-per-
in becomes a guarantee the port keeps locally, independent of App
behavior, interior totality, or smash. This exactly reproduces the
spec's §7 worked example (D→C→B→A: D sploots at 20s, C drops the
25s response as a ghost — C's own hop had expired).

**Stale responses.** Min-along-chain deadlines mean every hop on a
stale response's return path expires no later than the requester
did, so a stale deep response ghosts at the first expired,
not-yet-reoccupied hop it reaches. The residual window — a stale
ship arriving at a hop already re-occupied by a same-path successor
request — is ACCEPTED as anonymous flow (dann 2026-07-12, option
(a)): at declared ports there are no requests to defraud, only
wiring; "stale" is a provenance concept and declared-port flow has
no provenance. Commands remain exactly fenced by transience (a
per-invocation port that is destroyed at timeout; a late response
finds nothing). NO number-floor hardening (dann: cheap hardening
makes bad things harder to track down) — numbers can't fence eras
anyway (a stale request still queued at timeout docks later and
outnumbers the new occupant; the filter is one-way). To be solved
for real later if it matters in practice.

Ship numbers remain load-bearing elsewhere: determinism, and the
future concurrency algorithm (proving sibling independence). They
are not an era fence.

## What still needs building (revised task shape)

1. Parser: mid-chain port hop fix (task #2, unchanged).
2. Down-flavour dead exit stub removal (task #3, unchanged).
3. Port occupancy + ordinal response + ghost drop + queue-at-port
   (task #4, was "contract-carrier machinery" — now this). Two
   states only: FREE, OCCUPIED. Timeout-emits-empty-and-frees lands
   with virtual time; nothing in the occupancy machinery should
   presuppose more state than that. Ghost red guide: DET-harness
   dock-count-after-settle, written with this task — a space_test
   value assertion cannot express it under the ordinal ruling
   (which value continues is a schedule artifact); the space_test
   ghost test was converted to a deferred note 2026-07-12.
4. run_effect paired-space-port targets: deliver the request through
   the target port with the transient cmd port as return address
   (task #5, simplified — no contract to mint).
5. Rule-referenced sibling registration (task #6, unchanged).

## Residual open question

- FAF response sender: the response ship carries its emitter's (the
  responder's) sender, by standard propagation — no special case
  remains in the local model. Flagged only because §13 doesn't state
  it for the double-FAF processor shape; propose to spec it as plain
  propagation when the round-trip section is patched.

## Deferred (unchanged from v1)

- [roundtrip-enex-lhs] and [port-point-to-point] compile borks —
  after the machinery; ASCII emission migration separate (dann:
  fixtures are non-normative).
