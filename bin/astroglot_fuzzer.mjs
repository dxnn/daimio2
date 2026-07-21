// Astroglot fuzzer — generates random space definitions and runs them through
// D.make_some_space (parse + compile). The counterpart to bin/fuzzer.mjs, which
// fuzzes DAML through D.run.
//
// Looking for: JS crashes, prototype pollution, and unexpected soft errors —
// anything that isn't a clean compile or an intended compile rejection.
//
// The oracle uses the engine's own error model:
//   - a clean compile (returns a seed_id)                    → pass
//   - a bork (throw tagged e.is_bork) — the malformed-def
//     rejection contract [spacedef-hard-error]               → pass (expected)
//   - a throw WITHOUT is_bork (e.g. a raw RangeError)        → CRASH (a bug)
//   - a D.sploot whose message isn't on the allowlist        → CRASH (a bug)
//   - Object.prototype pollution                             → CRASH (a bug)
//
// Compilation is synchronous (no scheduler, no effectful commands), so unlike
// the DAML fuzzer there's no concurrency pool or per-expression timeout — a
// plain sequential loop. A genuinely infinite *sync* loop would freeze the run;
// generated sources are size/depth-bounded to stay well inside the engine's
// termination guarantees.
//
// Run with: node bin/astroglot_fuzzer.mjs [count] [seed] [-v] [--skip N] [--selftest]

var D = (await import('../daimio/daimio.js')).default

var verbose  = process.argv.includes('-v')
var selftest = process.argv.includes('--selftest')
var skip_idx = process.argv.indexOf('--skip')
var skip     = skip_idx !== -1 ? parseInt(process.argv[skip_idx + 1]) || 0 : 0

var count = parseInt(process.argv[2]) || 1000
var seed  = process.argv[3] || String(Date.now())

// Catch async errors (defensive — compile is sync, but hooks could defer)
var async_errors = []
process.on('uncaughtException', function(e) { async_errors.push(e.message) })

// Simple seeded PRNG (mulberry32) — same as bin/fuzzer.mjs, for reproducibility
function make_rng(seed_str) {
  var h = 0
  for (var i = 0; i < seed_str.length; i++)
    h = Math.imul(31, h) + seed_str.charCodeAt(i) | 0
  return function() {
    h |= 0; h = h + 0x6D2B79F5 | 0
    var t = Math.imul(h ^ h >>> 15, 1 | h)
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
}

var rng = make_rng(seed)
function pick(arr) { return arr[Math.floor(rng() * arr.length)] }
function rand_int(lo, hi) { return lo + Math.floor(rng() * (hi - lo + 1)) }
function chance(p) { return rng() < p }

// --- Vocabulary ---

// Real flavours (daimio/pflavs + engine builtins). A mix hits both valid ports
// and the "flavour could not be identified" / "must oppose direction" paths.
var IN_FLAVOURS  = ['from-js', 'websock-out', 'to-js', 'sse-receive', 'dom-on-click',
                    'dom-on-change', 'dom-on-blur', 'in']
var OUT_FLAVOURS = ['collect', 'websock-in', 'to-js', 'dom-set-text', 'dom-set-value',
                    'xhr-send', 'out']
var ANY_FLAVOURS = IN_FLAVOURS.concat(OUT_FLAVOURS, ['clock', 'err', 'zzz-bogus-flavour'])

var STATION_NAMES = ['proc', 'handler', 'worker', 'node', 'saver', 's', 'h', 'a', 'b', 'c',
                     'counter', 'sleeper', 'initializer', 'changed', 'caller']
var PORT_NAMES    = ['req', 'svc', 'feed', 'news', 'load', 'touched', 'x', 'y', 'fwd', 'a', 'b']
var SUB_NAMES     = ['inner', 'sub', 'alpha', 'beta', 'relay', 'mid', 'child', 'worker']
var SPACE_NAMES   = ['outer', 'top', 'app', 'root', 'main', 'sys']
var CMD_GLOBS     = ['time:now', 'time:*', 'var:read-out', 'var:*', '*', 'process:run']
var INDENT_UNITS  = ['  ', '  ', '  ', '    ', '\t', ' ', ' \t']   // per-tree indent style

// Mostly clean identifiers; occasionally hostile ones that stress the parser
// and the content-addressed seed hasher.
function gen_ident(base_list) {
  if (chance(0.90)) return pick(base_list)
  return pick([
    'z'.repeat(rand_int(40, 130)),                 // very long
    '9lead', '1', '-dash', 'has.dot', 'UPPER',
    'ünder', '__proto__', 'constructor', 'to\tab',
  ])
}

// --- DAML for station bodies (no '->', which the parser reads as a wire) ---

function gen_daml() {
  return pick([
    '{__}', '{:hello}', '{__ | add 1}', '{__ | math add value 2}',
    '{count}', '{handle}', '{sleep}', '{init}', '{save}', '{change}', '{proc}',
    '{var read-out name :x}', '{__ | >$change}', '{__ | >@out || ""}',
    '{(1 2 3) | list map block "{__ | add 1}"}', '{__ | string uppercase}',
    '{1}', '{2}', '{__ | >$x || _x}',
    // hostile — station-body DAML compile paths
    '{', '{|}', '{begin x}{end x}', '{__ | __}', '{no-such-cmd here}',
  ])
}

// Comment (/) and blank lines — the parser skips both; transparent structural
// noise that stresses the offset/continuation logic without changing outcomes.
function maybe_noise(out, pad) {
  if (chance(0.10)) out.push(pad + '/ ' + pick(['note', 'todo', 'xxx', 'a comment', '']))
  if (chance(0.06)) out.push(chance(0.5) ? '' : '   ')
}

// --- Line generators ---

function gen_port_line(pad, out_ports) {
  // Valid declarable directions only; @cmd-declared borks (injected elsewhere).
  var dir   = pick(['in', 'in', 'in', 'out', 'out', 'out', 'up', 'down'])
  var named = chance(0.5)
  var key   = '@' + dir + (named ? ':' + pick(PORT_NAMES) : '')
  var flav  = ''
  if (chance(0.6)) {
    var f = dir === 'in'  ? pick(IN_FLAVOURS)
          : dir === 'out' ? pick(OUT_FLAVOURS)
          : pick(ANY_FLAVOURS)
    flav = ' ' + f
    if (/^dom-/.test(f) && chance(0.5)) flav += ' .' + pick(['touch', 'go', 'x'])
  }
  out_ports.push(key)
  return pad + key + flav
}

function gen_state(ctx) {
  var name = pick(['count', 'items', 'data', 'result', 'x', 'src', 'flag'])
  var refs = ctx.defs.length ? ctx.defs : ['no_such_def_xyz']
  var val  = pick(['0', '42', '[]', '""', 'true', 'false', 'null', '{"a":1}',
                   '(:a :b)', '-1', '3.14',
                   pick(refs),             // definition reference [state-ref]
                   'no_such_def_xyz'])     // unresolved reference (borks)
  return '$' + name + ' ' + val
}

function gen_json() {
  return pick([
    '{"blocked_methods": {"process": ["unquote"]}}',
    '{"blocked_aliases": {}}',
    '{"blocked_methods": {}}',
    '{"binding": "news"}',
    '{broken json',
    '{not json}',
    '{',
    '{"a":}',
    '{"__proto__": {"polluted": true}}',                      // pollution vector
    '{"constructor": {"prototype": {"bad": true}}}',          // pollution vector
  ])
}

// A multiline station: a bare name, then more-indented DAML continuation lines
// (appended into the station's value). No @/$/-> in the body — those would make
// it a port/state/wire instead.
function gen_multiline_station(bpad, unit, stations) {
  var sn = gen_ident(STATION_NAMES)
  var lines = [bpad + sn]
  var n = rand_int(1, 2)
  for (var i = 0; i < n; i++) lines.push(bpad + unit + pick([
    '{__ | add 1}', 'plain text', '{:hello}', '{count}', '{__ | >$x}']))
  stations.push(sn)
  return lines
}

// A cmd wiring rule: holder@cmd:glob <-> target [timeout]. Compiles to a stored
// rule; an unknown holder/target or a duplicate pattern borks [demandport-wire].
function gen_wiring_rule(ctx, stations) {
  var holder = (chance(0.75) && stations.length) ? pick(stations)
             : pick(['ghost', 'nobody'])                      // unknown holder → bork
  var target = (chance(0.6) && stations.length) ? pick(stations)
             : chance(0.5) ? '@out'
             : pick(['nowhere', 'ghost'])                     // unknown target → bork
  var line = holder + '@cmd:' + pick(CMD_GLOBS) + ' <-> ' + target
  if (chance(0.4)) line += ' ' + pick([500, 1000, 10])
  return line
}

// Resolvable endpoints — routes built from these tend to compile.
function safe_endpoints(stations, ports, subs) {
  var pool = ['@in', '@out']
  ports.forEach(function(p) { if (/^@(in|out)/.test(p)) pool.push(p) })
  stations.forEach(function(s) { pool.push(s); pool.push(s) })       // weight stations
  subs.forEach(function(s) { pool.push(s + '@' + pick(['in', 'out'])) })
  if (chance(0.5)) pool.push(gen_daml())                             // inline anon station
  return pool
}

// Wild endpoints add the shapes that mostly bork: round-trip ports on a plain
// wire, foreign/unresolved refs, cmd targets, subspace round-trip ports.
function wild_endpoints(stations, ports, subs, ctx) {
  var pool = safe_endpoints(stations, ports, subs)
  ports.forEach(function(p) { pool.push(p) })
  if (chance(0.6)) pool.push(pick(['ghost', 'nowhere', 'undeclared_x'])
                             + (chance(0.5) ? '@in' : ''))
  if (chance(0.3)) pool.push((stations.length ? pick(stations) : 'h')
                             + '@cmd:' + pick(['time:now', 'var:read-out']))
  subs.forEach(function(s) { if (chance(0.4)) pool.push(s + '@' + pick(['down:x', 'up:x'])) })
  // scope-chain reference: wire to another definition by name — a visible
  // sibling/uncle/outer (valid) or an out-of-scope one (borks) [spacesyn-scope-chain]
  if (ctx.defs.length && chance(0.4))
    pool.push(pick(ctx.defs) + '@' + pick(['in', 'out', 'down:x']))
  return pool
}

function gen_route(stations, ports, subs, ctx) {
  var pool = chance(0.6) ? safe_endpoints(stations, ports, subs)
                         : wild_endpoints(stations, ports, subs, ctx)
  var hops = rand_int(2, 4)
  var eps  = []
  for (var i = 0; i < hops; i++) eps.push(pick(pool))
  var line = eps.join(' -> ')
  if (chance(0.15)) line += ' ' + pick([500, 1000, 10])              // trailing timeout
  return line
}

function gen_contract(stations) {
  var st = stations.length ? pick(stations) : 'h'
  return pick([
    // valid shapes
    '@up:req <-> ' + st,
    '@up:svc <-> @down:fwd',
    st + '@cmd:var:read-out <-> ' + st,
    // invalid shapes — each borks a distinct contract-validation path
    st + ' <-> ' + st,                    // station on LHS
    '@in <-> ' + st,                      // one-way port
    '@down:svc <-> ' + st,                // my-own down on LHS
    '@up:a <-> @up:b',                    // my-own up on RHS
    '@up:a <-> ' + st + ' <-> @up:b',     // three endpoints
    '@up:svc <-> ' + st + '@foo',         // station named port on RHS
  ])
}

// --- Space builders ---

// Emit one space definition (recursively, for nested subspaces) into `out`.
// kind: 'normal' | 'blackhole' | 'socket'. Top-level spaces are always normal.
// ctx carries the per-tree indent unit and the running list of visible
// definition names (for scope-chain references).
function gen_space(out, name, level, depth, kind, ctx) {
  var unit  = ctx.unit
  var pad   = unit.repeat(level)
  var bpad  = unit.repeat(level + 1)
  var sigil = level === 0 ? '' : (kind === 'blackhole' ? '*' : kind === 'socket' ? '!' : '+')
  out.push(pad + sigil + name)
  ctx.defs.push(name)

  var stations = [], ports = [], subs = []

  if (kind === 'blackhole') {
    // Black holes are ports-only, with flavour opposing direction.
    var np = rand_int(1, 3)
    for (var i = 0; i < np; i++) {
      var dir = pick(['in', 'out'])
      var flav = dir === 'in' ? pick(['websock-out', 'from-js', 'to-js'])
                              : pick(['websock-in', 'collect', 'to-js'])
      out.push(bpad + '@' + dir + ':' + pick(PORT_NAMES) + ' ' + flav)
    }
    if (chance(0.35)) out.push(bpad + pick([         // malformed hole line → bork
      'worker {__}', '@down:x websock-out', '@in:bad websock-in', '$count 0']))
    if (chance(0.30)) out.push(bpad + pick([         // hole metadata
      '{"binding":"news"}', '{"binding":"x","v":2}', '{not json}']))
    return
  }

  // normal / socket / root: two phases — declarations, then wiring.
  // (Mirrors the fixtures and yields many valid compiles; ordering and scope
  // violations still occur via foreign / out-of-scope references, which bork.)
  var n_decl = rand_int(1, 6)
  for (var d = 0; d < n_decl; d++) {
    maybe_noise(out, bpad)
    var r = rng()
    if (r < 0.32) {
      out.push(gen_port_line(bpad, ports))
    } else if (r < 0.50) {
      var sn = gen_ident(STATION_NAMES)
      out.push(bpad + sn + ' ' + gen_daml())
      stations.push(sn)
    } else if (r < 0.58) {
      gen_multiline_station(bpad, unit, stations).forEach(function(l) { out.push(l) })
    } else if (r < 0.68) {
      out.push(bpad + gen_state(ctx))
    } else if (r < 0.77) {
      out.push(bpad + gen_json())
    } else if (depth < 3) {
      var subkind = pick(['normal', 'normal', 'blackhole', 'socket'])
      gen_space(out, gen_ident(SUB_NAMES), level + 1, depth + 1, subkind, ctx)
      subs.push(ctx.defs[ctx.defs.length - 1])         // the name just pushed
    } else {
      out.push(bpad + gen_state(ctx))
    }
  }

  // duplicate declarations (station/station, port/port) — collision paths
  if (chance(0.06) && stations.length) out.push(bpad + pick(stations) + ' ' + gen_daml())
  if (chance(0.06) && ports.length)    out.push(bpad + pick(ports))

  // rare malformed injections that bork the whole space (exercise those paths)
  if (chance(0.05)) out.push(bpad + '@cmd:time:now websock-in')       // declared cmd port
  if (chance(0.05)) out.push(bpad + '*' + pick(SUB_NAMES) + '@in')    // sigil at endpoint

  // wiring phase: routes, contracts, cmd wiring rules
  var n_wire = rand_int(1, 4)
  for (var w = 0; w < n_wire; w++) {
    maybe_noise(out, bpad)
    var wr = rng()
    if (wr < 0.70)      out.push(bpad + gen_route(stations, ports, subs, ctx))
    else if (wr < 0.88) out.push(bpad + gen_contract(stations))
    else                out.push(bpad + gen_wiring_rule(ctx, stations))
  }
  if (chance(0.05)) {                                 // duplicate wiring rule → bork
    var rule = bpad + gen_wiring_rule(ctx, stations)
    out.push(rule); out.push(rule)
  }
}

function gen_garbage() {
  var chars = '{}|"():$>@_!*+#%^&[]<>-. \n\t0123456789abcdefghijklmnopqrstuvwxyz'
  var n = rand_int(1, 80)
  var s = ''
  for (var i = 0; i < n; i++) s += chars[Math.floor(rng() * chars.length)]
  return s
}

function gen_source() {
  var roll = rng()
  if (roll < 0.03) return gen_garbage()                              // pure garbage
  if (roll < 0.08) return pick(KNOWN_BORK)                           // known bork shapes
  if (roll < 0.14) return pick(KNOWN_VALID)                          // known valid shapes

  var n_spaces = rand_int(1, 3)
  var names = []
  while (names.length < n_spaces) {
    var nm = pick(SPACE_NAMES) + (names.length ? names.length : '')
    if (names.indexOf(nm) === -1) names.push(nm)
  }
  // ctx.defs accumulates every declared name (for scope-chain refs); the indent
  // unit varies per top-level space. A leading col-0 sigil borks (root cannot
  // be nested/hole/socket).
  var ctx = { defs: [], unit: pick(INDENT_UNITS) }
  var out = []
  for (var i = 0; i < n_spaces; i++) {
    ctx.unit = pick(INDENT_UNITS)
    var kind = 'normal'
    if (i === 0 && chance(0.04)) kind = pick(['blackhole', 'socket', 'normal'])
    gen_space(out, names[i], 0, 0, kind, ctx)
  }
  return out.join('\n')
}

// --- Known-good and known-bad corpora (from the fixtures / space_test.mjs) ---
// Guarantee coverage of well-formed multi-feature spaces and each bork path,
// and double as the --selftest oracle check.

var KNOWN_VALID = [
  'inner\n  @in\n  @out\n  @in -> {__ | add 1} -> @out\nouter\n  @in\n  @out\n  @in -> inner@in\n  inner@out -> @out',
  'cs\n  @up:req\n  proc {handle}\n  @up:req <-> proc',
  'worker\n  @down:svc\n  h {handle}\n  h -> @down:svc\nouter\n  @in\n  @out\n  @in -> worker@down:svc -> @out',
  'counter\n  $count 0\n  $items []',
  'alpha\n  @in\n  @out\n  @in -> {1} -> @out\nbeta\n  @in\n  @out\n  @in -> {2} -> @out',
  'cyc\n  @in\n  @out\n  counter {count}\n  sleeper {sleep}\n  @in -> counter\n  counter -> sleeper\n  sleeper -> counter\n  counter -> @out',
  'outer\n  {"blocked_methods": {"process": ["unquote"]}}\n  @init from-js\n  @init -> @out',
  '*relay\n  {"binding": "news"}\n  @in:feed websock-out\n  @out:news websock-in\nouter\n  @init from-js\n  @init -> relay@in:feed',
  'outer\n  @init from-js\n  caller {var read-out name :x}\n  handler {:hello}\n  caller@cmd:var:read-out <-> handler 500\n  @init -> caller',   // cmd wiring rule
  'outer\n  @out collect\n  s\n    {__ | add 1}\n  @in -> s -> @out',                     // multiline station
  'a\n\t@in\n\t@out\n\t@in -> @out',                                                        // tab-indented
  'outer\n  / a comment\n\n  @in\n  @out\n  @in -> @out',                                   // comments + blank lines
  'alpha\n  @in\n  @out\n  a {:a}\n  @in -> a\n  a -> @out\nouter\n  @in\n  @out\n  @in -> alpha@in\n  alpha@out -> @out',  // sibling scope ref
]

var KNOWN_BORK = [
  'outer\n  @init from-js\n  @cmd:time:now websock-in\n  @init -> @out',        // declared cmd port
  '+inner\n  @in -> @out\nouter\n  @init from-js\n  @init -> inner@in',          // sigil at col 0
  'outer\n  @init from-js\n  *relay\n    @in:feed websock-out\n    worker {__}\n  @init -> relay@in:feed',   // station in hole
  'outer\n  @init from-js\n  *relay\n    @in:feed websock-in\n  @init -> relay@in:feed',                     // hole flavour non-opposing
  'outer\n  @init from-js\n  *relay\n    @down:fetch websock-out\n  @init -> relay@in:feed',                 // up/down in hole
  '*relay\n  @in:feed websock-out\n  @out:news websock-in',                       // root black hole
  'outer\n  @init from-js\n  @in:load socket-load\n  @init -> @out',              // retired socket-load flavour
  'outer\n  @init from-js\n  *relay\n    @in:feed websock-out\n  @init -> *relay@in:feed',                   // *name endpoint ref
  '!worker\n  @in -> @out\nouter\n  @init from-js\n  @init -> worker@in',         // socket at col 0
  'outer\n  h {:x}\n  @up:a <-> h <-> @up:b',                                     // 3-endpoint contract
  'outer\n  handler {:x}\n  @init <-> handler',                                   // one-way port in contract
  'outer\n  @init from-js\n  foo {:station}\n  +foo\n    @in\n    @out\n  @init -> foo',   // station/subspace name collision
  'outer\n  {broken json\n  @init from-js\n  @init -> @out',                      // invalid JSON dialect
  'outer\n  {"blocked_methods": {}}\n  {"blocked_aliases": {}}\n  @init from-js\n  @init -> @out',   // second JSON object
  'a\n  +b',                                                                      // empty-body nested subspace (was a crash)
  'outer\n  h {:x}\n  h@cmd:time:now <-> h\n  h@cmd:time:now <-> h',              // duplicate wiring rule
  'outer\n  @out collect\n  ghost@cmd:time:now <-> @out',                         // unknown wiring rule holder
  'outer\n  h {:x}\n  h@cmd:time:now <-> nowhere',                                // unknown wiring rule target
]

// --- Oracle ---

// Soft-error allowlist: reuse the DAML fuzzer's battle-tested set, plus the
// compile-path sploots. Anything a D.sploot emits that ISN'T here is treated
// as a likely JS bug.
var sploot_patterns = [
  /^Missing required parameter/, /^You have failed to provide an adequate method/,
  /^Invalid parameter name/, /^Value ".*" not allowed for parameter/,
  /^Timeout on effectful command/, /^Orphaned response for/,
  /^Division by zero/, /^Modulation by zero/, /^Roots of negatives/,
  /^That is not a numeric value/, /^Range length exceeds/,
  /^The data parameter must contain/, /^Invalid timestamp/, /^Illegal key name/,
  /^Malformed selector/, /^No matching pathfinder/, /^Invalid block name/,
  /^That string is not a pipeline/, /^No corresponding port/, /^Invalid port/,
  /^Invalid spaceseed/, /^Invalid route/, /^Port not found/, /^Port flavour/,
  /^Every port must have/, /^That port/, /^That out port/, /^That flavour/,
  /^That dom thing/, /^You done messed up/, /^You seem to be lacking/,
  /^You must place a valid socket/, /^No fun found/, /^User-supplied regex/,
  /^Only __ and __in/, /^Your fancies/, /^Failed to load subspace/,
  /^Unwired effectful command/, /^Ghost ship/, /^Request timed out/,
  /^Round-trip port timed out/, /^Socket load splooted/, /^Cannot delete key/,
  /^Cannot poke key/, /^Subspace ".*" referenced before definition/, /^The alias/,
  /^No end tag for block/, /^Invalid code point/,
  /^Pipeline variables may be set at most once/, /^Recursion depth bound/,
  // compile-path additions (a3b3e3f)
  /^Subspace cannot declare/, /^Black-hole (formation|teardown)/,
  /^That port flavour has already/, /^Command ".*" must have exactly one/,
]

var unexpected_sploots = []
D.on_error = function(command, error) {
  var msg = String(error == null ? command : error)
  try {
    for (var i = 0; i < sploot_patterns.length; i++)
      if (sploot_patterns[i].test(msg)) return ''
  } catch(e) { return '' }
  unexpected_sploots.push(msg)
  return ''
}

// Suppress stdout during compile (the engine occasionally console.logs)
var real_log = console.log
function hush()   { console.log = function() {} }
function unhush() { console.log = real_log }

// Compile one source, classify the outcome, and leave global state as found.
function run_one(src) {
  unexpected_sploots = []
  var seed_keys  = Object.keys(D.SPACESEEDS)
  var block_keys = Object.keys(D.BLOCKS)
  var status = 'ok', error = null, stack = null

  hush()
  try {
    D.make_some_space(src)
  } catch(e) {
    if (e && e.is_bork) status = 'bork'                 // intended compile rejection
    else { status = 'crash'; error = e && e.message; stack = e && e.stack }
  } finally {
    unhush()
    // Clean up every seed/block minted this iteration (root AND subspaces),
    // so D.SPACESEEDS / D.BLOCKS don't accumulate or contaminate later runs.
    var sb = new Set(seed_keys)
    for (var k in D.SPACESEEDS) if (!sb.has(k)) delete D.SPACESEEDS[k]
    var bb = new Set(block_keys)
    for (var b in D.BLOCKS) if (!bb.has(b)) delete D.BLOCKS[b]
  }

  // Prototype pollution — space bodies parse JSON (dialect / meta / state)
  if (({}).polluted !== undefined || ({}).bad !== undefined) {
    delete Object.prototype.polluted; delete Object.prototype.bad   // reset for next iter
    return { status: 'pollution', expr: src, error: 'Object.prototype polluted' }
  }

  if (status === 'ok' && unexpected_sploots.length) {
    status = 'crash'
    error = 'unexpected sploot: ' + unexpected_sploots[0]
  }
  return { status: status, expr: src, error: error, stack: stack }
}

// --- Minimizer (line-based delta debugging) ---

function minimize(src, target_status) {
  var deadline = Date.now() + 2000
  var lines = src.split('\n')
  var changed = true
  while (changed && Date.now() < deadline) {
    changed = false
    for (var i = 0; i < lines.length; i++) {
      var cand = lines.slice(0, i).concat(lines.slice(i + 1))
      if (!cand.join('\n').trim()) continue
      if (run_one(cand.join('\n')).status === target_status) {
        lines = cand; changed = true; break
      }
    }
  }
  return lines.join('\n')
}

// --- Self-test: the oracle must classify the known corpora correctly ---

function run_selftest() {
  var bad = 0
  console.log('--- selftest: KNOWN_VALID must compile ---')
  KNOWN_VALID.forEach(function(s, i) {
    var r = run_one(s)
    if (r.status !== 'ok') {
      bad++
      console.log('  FAIL[' + i + '] expected ok, got ' + r.status +
        (r.error ? ' (' + r.error + ')' : '') + '\n    ' + JSON.stringify(s))
    }
  })
  console.log('--- selftest: KNOWN_BORK must bork ---')
  KNOWN_BORK.forEach(function(s, i) {
    var r = run_one(s)
    if (r.status !== 'bork') {
      bad++
      console.log('  FAIL[' + i + '] expected bork, got ' + r.status +
        (r.error ? ' (' + r.error + ')' : '') + '\n    ' + JSON.stringify(s))
    }
  })
  console.log(bad ? ('\nSELFTEST FAILED: ' + bad + ' mismatch(es)')
                  : '\nSELFTEST OK: oracle classifies all ' +
                    (KNOWN_VALID.length + KNOWN_BORK.length) + ' corpus cases correctly')
  process.exit(bad ? 1 : 0)
}

// --- Main ---

console.log('Astroglot Fuzzer')
if (selftest) run_selftest()

console.log('Count:', count, ' Seed:', seed, verbose ? ' Verbose' : '',
  skip > 0 ? ' Skip: ' + skip : '')
console.log('')

var passed = 0, borked = 0, crashes = 0, pollution = 0
var errors = []
var start = Date.now()

for (var i = 0; i < count; i++) {
  var src = gen_source()
  if (i < skip) continue
  if (verbose) process.stderr.write((i + 1) + ':\n' + src + '\n---\n')

  var result = run_one(src)
  if      (result.status === 'ok')        passed++
  else if (result.status === 'bork')      borked++
  else {
    if (result.status === 'pollution') pollution++; else crashes++
    result.index = i + 1
    console.log('  ' + result.status.toUpperCase() + ' ' + (i + 1) + ': ' +
      JSON.stringify(result.expr).slice(0, 160))
    if (result.error) console.log('    ', result.error)
    errors.push(result)
  }

  if ((i + 1) % 10000 === 0) {
    var el = ((Date.now() - start) / 1000).toFixed(1)
    console.log('  ... ' + (i + 1) + '/' + count + ' (' + passed + ' ok, ' +
      borked + ' bork, ' + crashes + ' crash, ' + el + 's)')
  }
}

// Minimize failures
if (errors.length) {
  console.log('\n--- Minimizing ' + errors.length + ' failure(s) ---')
  for (var e = 0; e < errors.length; e++) {
    var f = errors[e]
    var minimal = minimize(f.expr, f.status)
    console.log('  ' + f.status.toUpperCase() + ' ' + f.index + ':\n' +
      minimal.split('\n').map(function(l) { return '    ' + l }).join('\n'))
    if (f.error) console.log('    error: ' + f.error)
  }
}

var elapsed = ((Date.now() - start) / 1000).toFixed(1)
console.log('\n=== Results ===')
console.log('Passed (compiled):', passed)
console.log('Borked (rejected):', borked)
console.log('Crashes:          ', crashes)
console.log('Pollution:        ', pollution)
console.log('Async:            ', async_errors.length)
console.log('Total:            ', count)
console.log('Time:             ', elapsed + 's')

if (async_errors.length) {
  console.log('\nAsync errors (uncaughtException):')
  for (var a = 0; a < async_errors.length; a++) console.log('  ' + async_errors[a])
}

if (crashes || pollution || async_errors.length) {
  console.log('\nFAIL: ' + crashes + ' crashes, ' + pollution + ' pollution, ' +
    async_errors.length + ' async errors')
  process.exit(1)
} else {
  console.log('\nOK: all ' + count + ' sources compiled or borked cleanly')
  process.exit(0)
}
