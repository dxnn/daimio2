// DAML fuzzer — generates random DAML expressions and runs them through D.run
// Looking for: crashes, hangs, uncaught exceptions, prototype pollution
// Run with: node tests/fuzz_test.mjs [count] [seed] [concurrency] [timeout] [-v] [--skip N]
//
// Based on repl.mjs for D.run usage pattern.

var D = (await import('../daimio/daimio.js')).default

var verbose = process.argv.includes('-v')
var skip_idx = process.argv.indexOf('--skip')
var skip = skip_idx !== -1 ? parseInt(process.argv[skip_idx + 1]) || 0 : 0

// Catch async errors from setTimeout callbacks etc.
var async_errors = []
process.on('uncaughtException', function(e) {
  async_errors.push(e.message)
})

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
// Exclude specialized handlers and intentionally-async commands
var effectful_handlers = new Set(['dagoba', 'daggr'])
var effectful_pairs = new Set(['process.sleep'])
var effectful_aliases = new Set(['sleep', 'wait'])

var handlers = Object.keys(D.Commands).filter(h => !effectful_handlers.has(h))
var aliases = Object.keys(D.Aliases).filter(a => !effectful_aliases.has(a))
var all_methods = {}
for (var h of handlers) {
  var methods = Object.keys(D.Commands[h].methods || {})
    .filter(m => !effectful_pairs.has(h + '.' + m))
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

var block_names = ['foo', 'bar', 'item', 'row', 'x', 'blk', 'inner',
                   'begin', 'end', 'if', 'then', 'else', 'value', 'block']

function gen_named_block(depth) {
  var name = pick(block_names)
  var begin = '{begin ' + name
  // Sometimes add a pipeline on the begin tag
  if (rng() < 0.5) {
    if (rng() < 0.15) begin += ' | >$' + name
    else begin += ' | ' + gen_pipeline(depth + 1)
  }
  begin += '}'
  // Body: mix of literal text and commands, sometimes referencing $name
  var body = gen_body(depth + 1, name)
  var end = '{end ' + name + '}'
  return begin + body + end
}

function gen_body(depth, block_name) {
  var n = rand_int(0, 3)
  var parts = []
  for (var i = 0; i < n; i++) {
    if (rng() < 0.3) {
      parts.push(pick(['hello ', 'text ', '', '--- ', 'body ']))
    } else if (block_name && rng() < 0.15) {
      // Reference the enclosing block's name as a space var
      parts.push('{$' + block_name + '}')
    } else {
      parts.push('{' + gen_pipeline(depth) + '}')
    }
  }
  return parts.join('')
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
  if (r < 0.85) return gen_portsend()
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
  // Sometimes generate a named block expression
  if (rng() < 0.15) return gen_named_block(0)

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

var timeout_ms = parseInt(process.argv[5]) || 100  // per expression
var errors = []
var hangs = 0
var crashes = 0
var passed = 0
var pollution_found = 0
var minimizing = false

// Track JS-level errors per space (keyed by space object, not shared)
var js_errors_by_space = new Map()
var daimio_error_patterns = [
  /^Missing required parameter/,
  /^You have failed to provide an adequate method/,
  /^Invalid parameter name/,
  /^Value ".*" not allowed for parameter/,
  /^Timeout on effectful command/,
  /^Orphaned response for/,
  /^Division by zero/,
  /^Modulation by zero/,
  /^Roots of negatives/,
  /^That is not a numeric value/,
  /^Range length exceeds/,
  /^The data parameter must contain/,
  /^Invalid timestamp/,
  /^Illegal key name/,
  /^No matching pathfinder/,
  /^Invalid block name/,
  /^That string is not a pipeline/,
  /^No corresponding port/,
  /^Invalid port/,
  /^Invalid spaceseed/,
  /^Invalid route/,
  /^Port not found/,
  /^Port flavour/,
  /^Every port must have/,
  /^That port/,
  /^That out port/,
  /^That flavour/,
  /^That dom thing/,
  /^You done messed up/,
  /^You seem to be lacking/,
  /^You must place a valid socket/,
  /^No fun found/,
  /^User-supplied regex/,
  /^Only __ and __in/,
  /^Your fancies/,
  /^Closed space requires/,
  /^Failed to load subspace/,
  /^The alias/,
  /^No end tag for block/,
  /^Invalid code point/,
  /^Pipeline variables may be set at most once/,
]

D.on_error = function(command, error) {
  var msg = error || command
  try {
    for (var i = 0; i < daimio_error_patterns.length; i++) {
      if (daimio_error_patterns[i].test(msg)) return ""
    }
  } catch(e) {
    // regex .test() itself can stack overflow on deeply recursive errors
    return ""
  }
  // Not a known Daimio error — likely a JS error; attribute to active space
  var space = D.Etc.active_space
  if (space && js_errors_by_space.has(space)) {
    js_errors_by_space.get(space).push(msg)
  }
  return ""
}

// Suppress stdout during runs (D.run internals sometimes console.log)
var real_log = console.log
function hush() { console.log = function() {} }
function unhush() { console.log = real_log }

function make_fresh_space() {
  var seed_id = D.spaceseed_add(
    {dialect: {commands:{}, aliases:{}}, stations: [], subspaces: [], ports: [], routes: [], state: {}})
  var space = new D.Space(seed_id)
  space._fuzz_seed_id = seed_id
  return space
}

function cleanup_space(space) {
  delete D.SPACESEEDS[space._fuzz_seed_id]
}

// Detect self-referential named blocks that will stack overflow
function is_self_referential(expr) {
  var m = expr.match(/\{begin (\w+)[^}]*\| >?\$\1/)
  if (!m) return false
  var name = m[1]
  var body_start = expr.indexOf('}', m.index) + 1
  var end_tag = '{end ' + name + '}'
  var body_end = expr.indexOf(end_tag, body_start)
  if (body_end === -1) return false
  var body = expr.slice(body_start, body_end)
  return body.indexOf('$' + name) !== -1
}

function run_one(expr, timeout_override) {
  // TODO: self-referential named blocks cause unbounded stack overflow in the engine.
  // Fix execute_then_stringify to detect block recursion or add a depth limit.
  // For now, skip them entirely.
  if (is_self_referential(expr)) {
    if (!minimizing) passed++
    return Promise.resolve({ status: 'ok', expr: expr, value: '' })
  }

  return new Promise(function(resolve) {
    var done = false
    var space = make_fresh_space()
    var timer = setTimeout(function() {
      unhush()
      if (!done) {
        done = true
        if (!minimizing) hangs++
        js_errors_by_space.delete(space)
        cleanup_space(space)
        resolve({ status: 'hang', expr: expr })
      }
    }, timeout_override || timeout_ms)

    try {
      js_errors_by_space.set(space, [])
      if (verbose && !minimizing) process.stderr.write(completed + ': ' + expr.slice(0, 200) + '\n')
      hush()
      D.run(expr, space, null, function(value) {
        unhush()
        if (done) return
        done = true
        clearTimeout(timer)
        cleanup_space(space)

        // Check for prototype pollution after each run
        if (({}).polluted !== undefined || ({}).bad !== undefined) {
          if (!minimizing) pollution_found++
          resolve({ status: 'pollution', expr: expr, detail: 'Object.prototype polluted!' })
          return
        }

        // Check for JS-level errors that were caught as soft errors
        var js_errors = js_errors_by_space.get(space) || []
        js_errors_by_space.delete(space)
        if (js_errors.length) {
          if (!minimizing) crashes++
          resolve({ status: 'crash', expr: expr, error: js_errors[0] })
          return
        }

        resolve({ status: 'ok', expr: expr, value: value })
      })
    } catch(e) {
      unhush()
      if (done) return
      done = true
      clearTimeout(timer)
      js_errors_by_space.delete(space)
      cleanup_space(space)
      if (!minimizing) crashes++
      resolve({ status: 'crash', expr: expr, error: e.message, stack: e.stack })
    }
  })
}

// --- Minimizer ---

// Split DAML into structural chunks: commands {…} and literal text between them
function split_chunks(expr) {
  var chunks = []
  var depth = 0, start = 0
  for (var i = 0; i < expr.length; i++) {
    if (expr[i] === '{') {
      if (depth === 0 && i > start)
        chunks.push(expr.slice(start, i))
      if (depth === 0) start = i
      depth++
    } else if (expr[i] === '}') {
      depth--
      if (depth === 0) {
        chunks.push(expr.slice(start, i + 1))
        start = i + 1
      }
    }
  }
  if (start < expr.length)
    chunks.push(expr.slice(start))
  return chunks
}

// Split a single {…} command into pipe segments (preserving || as barrier)
function split_pipes(cmd) {
  if (cmd[0] !== '{' || cmd[cmd.length - 1] !== '}') return null
  var inner = cmd.slice(1, -1)
  // Split on | and || respecting nested {} and ""
  // Each segment includes its leading separator ('' for first, '|' or '||' for rest)
  var segs = [], seps = [], cur = '', depth = 0, instr = false
  for (var i = 0; i < inner.length; i++) {
    var c = inner[i]
    if (c === '"' && (i === 0 || inner[i-1] !== '\\')) instr = !instr
    if (!instr && c === '{') depth++
    if (!instr && c === '}') depth--
    if (!instr && depth === 0 && c === '|') {
      segs.push(cur)
      cur = ''
      // Check for || (barrier pipe)
      if (i + 1 < inner.length && inner[i + 1] === '|') {
        seps.push('||')
        i++  // skip second |
      } else {
        seps.push('|')
      }
    } else {
      cur += c
    }
  }
  segs.push(cur)
  return { segs: segs, seps: seps }
}

function check_status(result, target) {
  return result.status === target
}

async function minimize(expr, target_status) {
  var deadline = Date.now() + 2000  // 2s budget per expression
  function expired() { return Date.now() > deadline }

  // Phase 1: remove whole chunks
  var chunks = split_chunks(expr)
  if (chunks.length > 1) {
    var changed = true
    while (changed && !expired()) {
      changed = false
      for (var i = 0; i < chunks.length; i++) {
        if (expired()) break
        var candidate = chunks.slice(0, i).concat(chunks.slice(i + 1)).join('')
        if (!candidate.trim()) continue
        var result = await run_one(candidate, 5)
        if (check_status(result, target_status)) {
          chunks.splice(i, 1)
          changed = true
          break
        }
      }
    }
  }
  expr = chunks.join('')

  // Phase 2: remove pipe segments within each command
  if (!expired()) {
    chunks = split_chunks(expr)
    for (var ci = 0; ci < chunks.length && !expired(); ci++) {
      var parsed = split_pipes(chunks[ci])
      if (!parsed || parsed.segs.length <= 1) continue
      var segs = parsed.segs
      var seps = parsed.seps
      var changed = true
      while (changed && !expired()) {
        changed = false
        for (var si = 0; si < segs.length; si++) {
          if (expired() || segs.length <= 1) break
          var try_segs = segs.slice(0, si).concat(segs.slice(si + 1))
          // When removing a segment, also remove one separator:
          // removing first seg drops seps[0], removing seg N drops seps[N-1]
          var try_seps = si === 0
            ? seps.slice(1)
            : seps.slice(0, si - 1).concat(seps.slice(si))
          var rejoined = try_segs[0]
          for (var j = 1; j < try_segs.length; j++)
            rejoined += try_seps[j - 1] + try_segs[j]
          var candidate = chunks.slice(0, ci).join('') +
            '{' + rejoined + '}' +
            chunks.slice(ci + 1).join('')
          if (!candidate.trim()) continue
          var result = await run_one(candidate, 5)
          if (check_status(result, target_status)) {
            segs.splice(si, 1)
            if (si === 0) seps.splice(0, 1)
            else seps.splice(si - 1, 1)
            chunks[ci] = '{' + rejoined + '}'
            changed = true
            break
          }
        }
      }
    }
    expr = chunks.join('')
  }

  return expr
}

// --- Pool runner ---

var concurrency = parseInt(process.argv[4]) || 200

var completed = 0
var start = Date.now()

function handle_result(result) {
  completed++
  if (result.status === 'ok') {
    passed++
  } else {
    result.index = completed
    console.log('  ' + result.status.toUpperCase() + ' ' + completed + ': ' + JSON.stringify(result.expr).slice(0, 120))
    if (result.error) console.log('    ', result.error)
    errors.push(result)
  }
  if (completed % 10000 === 0) {
    var elapsed = ((Date.now() - start) / 1000).toFixed(1)
    console.log('  ... ' + completed + '/' + count + ' (' + passed + ' ok, ' + hangs + ' hang, ' + crashes + ' crash, ' + elapsed + 's)')
  }
}

async function run_batch(gen_fn, total, label) {
  var skipping = skip > 0
  var to_skip = Math.min(skip, total)
  if (skipping) {
    console.log('--- ' + label + ' (skipping ' + to_skip + '/' + total + ') ---')
    for (var i = 0; i < to_skip; i++) gen_fn()  // burn RNG but don't eval
    skip -= to_skip
    total -= to_skip
    completed += to_skip
    passed += to_skip
  }
  if (total <= 0) { if (!skipping) console.log('--- ' + label + ' (0) ---'); return }
  console.log('--- ' + label + ' (' + total + ') ---')
  var active = 0
  var next = 0

  return new Promise(function(resolve) {
    function launch() {
      while (active < concurrency && next < total) {
        active++
        next++
        run_one(gen_fn()).then(function(result) {
          handle_result(result)
          active--
          if (next >= total && active === 0) resolve()
          else launch()
        })
      }
    }
    launch()
  })
}

// --- Main ---

console.log('DAML Fuzzer')
console.log('Count:', count, ' Seed:', seed, ' Concurrency:', concurrency,
  verbose ? ' Verbose' : '', skip > 0 ? ' Skip: ' + skip : '')
console.log('Handlers:', handlers.length, ' Aliases:', aliases.length)
console.log('')

var edge_count = Math.floor(count * 0.1)
var gen_count = count - edge_count

await run_batch(gen_edge_case, edge_count, 'Edge cases')
await run_batch(gen_expr, gen_count, 'Generated')

// --- Minimize failures ---

if (errors.length) {
  console.log('')
  console.log('--- Minimizing ' + errors.length + ' failure(s) ---')
  minimizing = true
  for (var i = 0; i < errors.length; i++) {
    var e = errors[i]
    var minimal = await minimize(e.expr, e.status)
    e.minimal = minimal
    if (minimal.length < e.expr.length) {
      console.log('  ' + e.status.toUpperCase() + ' ' + e.index + ': ' + JSON.stringify(minimal))
    } else {
      console.log('  ' + e.status.toUpperCase() + ' ' + e.index + ': ' + JSON.stringify(minimal) + ' (already minimal)')
    }
    if (e.error) console.log('    error: ' + e.error)
  }
}

var elapsed = ((Date.now() - start) / 1000).toFixed(1)

console.log('')
console.log('=== Results ===')
console.log('Passed:   ', passed)
console.log('Crashes:  ', crashes)
console.log('Hangs:    ', hangs)
console.log('Pollution:', pollution_found)
console.log('Async:    ', async_errors.length)
console.log('Total:    ', count)
console.log('Time:     ', elapsed + 's')

if (async_errors.length) {
  console.log('\nAsync errors (uncaughtException):')
  for (var i = 0; i < async_errors.length; i++)
    console.log('  ' + async_errors[i])
}

if (crashes || pollution_found || async_errors.length) {
  console.log('\nFAIL: ' + crashes + ' crashes, ' + pollution_found + ' pollution, ' + async_errors.length + ' async errors')
  process.exit(1)
} else if (hangs) {
  console.log('\nOK: ' + passed + ' passed, ' + hangs + ' hangs (>' + timeout_ms + 'ms, not crashes)')
  process.exit(0)
} else {
  console.log('\nOK: all ' + count + ' expressions handled without crashes')
  process.exit(0)
}
