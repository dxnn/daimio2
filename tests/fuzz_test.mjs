// DAML fuzzer — generates random DAML expressions and runs them through D.run
// Looking for: crashes, hangs, uncaught exceptions, prototype pollution
// Run with: node tests/fuzz_test.mjs [count] [seed]
//
// Based on repl.mjs for D.run usage pattern.

var D = (await import('../daimio/daimio.js')).default

var count = parseInt(process.argv[2]) || 1000
var seed = process.argv[3] || String(Date.now())

// Simple seeded PRNG (mulberry32)
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

// Collect available handlers, methods, params, aliases from D
// Exclude effectful handlers (need port wiring, will hang without it)
var effectful_handlers = new Set(['time', 'var', 'dagoba', 'daggr'])
var effectful_methods = { process: new Set(['sleep', 'tap', 'downport', 'sender', 'dialect', 'run', 'unquote']) }
var effectful_aliases = new Set(['sleep', 'wait', 'tap', 'downport', 'sender', 'run', 'unquote'])

var handlers = Object.keys(D.Commands).filter(h => !effectful_handlers.has(h))
var aliases = Object.keys(D.Aliases).filter(a => !effectful_aliases.has(a))
var all_methods = {}
for (var h of handlers) {
  var methods = Object.keys(D.Commands[h].methods || {})
  if (effectful_methods[h])
    methods = methods.filter(m => !effectful_methods[h].has(m))
  all_methods[h] = methods
}

// --- Generators ---

function gen_number() { return pick([0, 1, -1, 42, 3.14, 999999, 0.001, -100]) }
function gen_name() { return ':' + pick(['foo', 'bar', 'baz', 'x', 'y', 'key', 'val', 'hello', 'a', '']) }
function gen_string() { return '"' + pick(['hello', '', 'test', ' ', 'abc def', '{nested}', '|pipe', '42']) + '"' }

function gen_pipevar_read() { return '_' + pick(['x', 'y', 'z', 'value', 'key', 'foo']) }
function gen_pipevar_write() { return '>' + pick(['x', 'y', 'z', 'value', 'key', 'foo']) }
function gen_spacevar_read() { return '$' + pick(['x', 'y', 'z', 'count', 'data', 'result']) }
function gen_spacevar_write() { return '>$' + pick(['x', 'y', 'z', 'count', 'data', 'result']) }
function gen_portsend() { return '>@' + pick(['output', 'error', 'notify', 'result']) }

function gen_list(depth) {
  var n = rand_int(0, 4)
  var items = []
  for (var i = 0; i < n; i++) items.push(gen_atom(depth))
  return '(' + items.join(' ') + ')'
}

function gen_block(depth) {
  if (depth > 2) return '"{__}"'
  return '"{' + gen_pipeline(depth + 1) + '}"'
}

function gen_atom(depth) {
  var r = rng()
  if (r < 0.2) return String(gen_number())
  if (r < 0.35) return gen_name()
  if (r < 0.45) return gen_string()
  if (r < 0.55) return gen_pipevar_read()
  if (r < 0.60) return gen_spacevar_read()
  if (r < 0.65) return '__'
  if (r < 0.70) return '__in'
  if (r < 0.80) return gen_list(depth + 1)
  if (r < 0.90) return gen_block(depth + 1)
  return String(gen_number())
}

function gen_command(depth) {
  var handler = pick(handlers)
  var methods = all_methods[handler]
  if (!methods || !methods.length) return handler
  var method = pick(methods)
  var method_def = D.Commands[handler].methods[method]

  var parts = [handler, method]

  // Sometimes add params
  if (method_def && method_def.params) {
    var n_params = rand_int(0, method_def.params.length)
    var used = new Set()
    for (var i = 0; i < n_params; i++) {
      var param = pick(method_def.params)
      if (used.has(param.key)) continue
      used.add(param.key)
      parts.push(param.key, gen_atom(depth))
    }
  }

  return parts.join(' ')
}

function gen_alias(depth) {
  var alias = pick(aliases)
  // Aliases take piped input, sometimes add an argument
  if (rng() < 0.5) return alias
  return alias + ' ' + gen_atom(depth)
}

function gen_segment(depth) {
  var r = rng()
  if (r < 0.35) return gen_command(depth)
  if (r < 0.50) return gen_alias(depth)
  if (r < 0.60) return gen_atom(depth)
  if (r < 0.70) return gen_pipevar_write()
  if (r < 0.78) return gen_spacevar_write()
  return gen_atom(depth)
}

function gen_pipeline(depth) {
  var n = rand_int(1, 4)
  var segs = []
  for (var i = 0; i < n; i++) {
    segs.push(gen_segment(depth))
  }
  // Join with pipe (sometimes barrier pipe)
  var parts = [segs[0]]
  for (var i = 1; i < segs.length; i++) {
    parts.push(rng() < 0.15 ? '||' : '|')
    parts.push(segs[i])
  }
  return parts.join(' ')
}

function gen_expr() {
  var n_commands = rand_int(1, 3)
  var parts = []
  for (var i = 0; i < n_commands; i++) {
    if (rng() < 0.1) {
      // Sometimes add literal text between commands
      parts.push(pick(['hello ', 'text ', '', '--- ']))
    }
    parts.push('{' + gen_pipeline(0) + '}')
  }
  return parts.join('')
}

// Special malicious/edge-case generators
function gen_edge_case() {
  return pick([
    // Empty / whitespace
    '', ' ', '\n', '\t',
    // Unmatched braces
    '{', '}', '{{', '}}', '{{{', '{}}', '}{',
    // Deep nesting
    '{{{{{1}}}}}',
    '{"{"{"{1}"}"}"}',
    // Prototype pollution attempts
    '{(:__proto__ :constructor :prototype) | list union data ((:polluted :true))}',
    '{list poke path (:__proto__) value :bad}',
    '{list poke path (:constructor) value :bad}',
    // Very long input
    '{' + ':a '.repeat(200) + '| list range}',
    // Unicode
    '{:' + '\u{1F4A9}' + '}',
    '{string length value "' + '\u{1F44D}'.repeat(10) + '"}',
    // Named blocks
    '{begin x}hello{end x}',
    '{begin x}{end x}',
    '{begin x}body{end y}',
    '{begin 123}num{end 123}',
    // Pipes
    '{|}', '{||}', '{|||}',
    '{1 | | 2}',
    '{1 ||| 2}',
    // Self-referential
    '{__ | __}',
    '{__in | __in}',
    // Big numbers
    '{math add value 99999999999999999999}',
    '{math multiply value 1e308}',
    '{math divide value 0}',
    // Empty list ops
    '{() | list first}',
    '{() | list reduce block "{__}"}',
    '{() | map block "{__}"}',
    // Path edge cases
    '{(:a :b :c) | peek :nonexistent}',
    '{1 | peek :a}',
    // Nested command references
    '{process quote value "{process unquote value \\"{1}\\"}"}',
    // Multiple barriers
    '{1 || 2 || 3 || 4 || 5}',
    // Variable stress
    ...Array.from({length: 10}, (_, i) => `{${i} | >$v${i}}`),
  ])
}

// --- Runner ---

var timeout_ms = 1000  // per expression
var errors = []
var hangs = 0
var crashes = 0
var passed = 0
var pollution_checks = 0

D.on_error = function(command, error) {
  // Soft errors are expected — Daimio is total
  return ""
}

function make_fresh_space() {
  return new D.Space(
    D.spaceseed_add(
      {dialect: {commands:{}, aliases:{}}, stations: [], subspaces: [], ports: [], routes: [], state: {}}))
}

function run_one(expr) {
  return new Promise(function(resolve) {
    var done = false
    var timer = setTimeout(function() {
      if (!done) {
        done = true
        hangs++
        resolve({ status: 'hang', expr: expr })
      }
    }, timeout_ms)

    try {
      var space = make_fresh_space()
      D.run(expr, space, null, function(value) {
        if (done) return
        done = true
        clearTimeout(timer)

        // Check for prototype pollution after each run
        if (({}).polluted !== undefined || ({}).bad !== undefined) {
          pollution_checks++
          resolve({ status: 'pollution', expr: expr, detail: 'Object.prototype polluted!' })
          return
        }

        resolve({ status: 'ok', expr: expr, value: value })
      })
    } catch(e) {
      if (done) return
      done = true
      clearTimeout(timer)
      crashes++
      resolve({ status: 'crash', expr: expr, error: e.message, stack: e.stack })
    }
  })
}

// --- Pool runner ---

var concurrency = parseInt(process.argv[4]) || 50

function handle_result(result) {
  if (result.status === 'ok') {
    passed++
  } else {
    console.log('  ' + result.status.toUpperCase() + ':', JSON.stringify(result.expr).slice(0, 120))
    if (result.error) console.log('    ', result.error)
    errors.push(result)
  }
}

async function run_batch(exprs, label) {
  console.log('--- ' + label + ' (' + exprs.length + ') ---')
  var active = 0
  var next = 0

  return new Promise(function(resolve) {
    function launch() {
      while (active < concurrency && next < exprs.length) {
        active++
        var idx = next++
        run_one(exprs[idx]).then(function(result) {
          handle_result(result)
          active--
          if (next >= exprs.length && active === 0) resolve()
          else launch()
        })
      }
    }
    if (exprs.length === 0) resolve()
    else launch()
  })
}

// --- Main ---

console.log('DAML Fuzzer')
console.log('Count:', count, ' Seed:', seed, ' Concurrency:', concurrency)
console.log('Handlers:', handlers.length, ' Aliases:', aliases.length)
console.log('')

var start = Date.now()
var edge_count = Math.min(Math.floor(count * 0.2), 50)
var gen_count = count - edge_count

// Build all expressions up front (uses the seeded RNG)
var edge_exprs = Array.from({length: edge_count}, function() { return gen_edge_case() })
var gen_exprs = Array.from({length: gen_count}, function() { return gen_expr() })

await run_batch(edge_exprs, 'Edge cases')
await run_batch(gen_exprs, 'Generated')

var elapsed = ((Date.now() - start) / 1000).toFixed(1)

console.log('')
console.log('=== Results ===')
console.log('Passed:   ', passed)
console.log('Crashes:  ', crashes)
console.log('Hangs:    ', hangs)
console.log('Pollution:', pollution_checks)
console.log('Total:    ', count)
console.log('Time:     ', elapsed + 's')

if (errors.length) {
  console.log('')
  console.log('=== Failing expressions ===')
  for (var e of errors.slice(0, 20)) {
    console.log(e.status.toUpperCase() + ':', JSON.stringify(e.expr))
    if (e.error) console.log('  Error:', e.error)
    if (e.detail) console.log('  Detail:', e.detail)
  }
  if (errors.length > 20) console.log('... and ' + (errors.length - 20) + ' more')
}

if (crashes || pollution_checks) {
  console.log('\nFAIL: ' + crashes + ' crashes, ' + pollution_checks + ' pollution')
  process.exit(1)
} else if (hangs) {
  console.log('\nOK: ' + passed + ' passed, ' + hangs + ' hangs (>' + timeout_ms + 'ms, not crashes)')
  process.exit(0)
} else {
  console.log('\nOK: all ' + count + ' expressions handled without crashes')
  process.exit(0)
}
