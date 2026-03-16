// Daimio performance regression tests
// Run with: node tests/perf_test.mjs
//
// Self-calibrating: measures each benchmark as a ratio to a calibration run.
// Fails if any benchmark exceeds its expected ratio by more than 3x.
// This makes the suite portable across machines of different speeds.

var D = (await import('../daimio/daimio.js')).default

var iterations = 3
var threshold_multiplier = 3

// ── Helpers ─────────────────────────────────────────────────────────

function median(arr) {
  var sorted = arr.slice().sort(function(a, b) { return a - b })
  var mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function run_timed(daml, n) {
  return new Promise(function(resolve) {
    var times = []
    var done = 0
    function run_one() {
      var start = performance.now()
      D.run(daml, function() {
        times.push(performance.now() - start)
        done++
        if(done < n) run_one()
        else resolve(median(times))
      })
    }
    run_one()
  })
}

function dedent(s) {
  var lines = s.split('\n')
  while(lines.length && !lines[0].trim()) lines.shift()
  var min = Infinity
  lines.forEach(function(line) {
    if(!line.trim()) return
    var indent = line.search(/\S/)
    if(indent < min) min = indent
  })
  if(min === Infinity) min = 0
  return lines.map(function(line) { return line.slice(min) }).join('\n')
}

// ── Collect port flavour (for space benchmarks) ─────────────────────

var space_callbacks = {}
var space_id_counter = 0

D.import_port_flavour('perf-collect', {
  dir: 'out',
  outside_exit: function(ship) {
    var space = this.pair.space
    var entry = space_callbacks[space._perf_id]
    if(!entry) return
    entry.count++
    if(entry.count >= entry.expected) {
      entry.resolve()
    }
  }
})

function run_space_timed(seedlike, make_send, send_count, n) {
  seedlike = dedent(seedlike)
  return new Promise(function(resolve) {
    var times = []
    var done = 0
    function run_one() {
      var perf_id = ++space_id_counter
      var seed_id = D.make_some_space(seedlike)
      var space = new D.Space(seed_id)
      space._perf_id = perf_id

      var start = performance.now()
      space_callbacks[perf_id] = {
        count: 0,
        expected: send_count,
        resolve: function() {
          times.push(performance.now() - start)
          delete space_callbacks[perf_id]
          done++
          if(done < n) run_one()
          else resolve(median(times))
        }
      }

      for(var i = 0; i < send_count; i++) {
        var send = make_send(i)
        D.send_value_to_js_port(space, send.port, send.value)
      }
    }
    run_one()
  })
}

// ── Benchmarks ──────────────────────────────────────────────────────

var calibration_daml = '{range 5000 | map block "{__ | add 1 | multiply 2}"}'

var benchmarks = [
  {
    name: 'list_reduce',
    expected_ratio: 1.0,
    run: function() { return run_timed('{range 7000 | reduce block "{_total | add _value}"}', iterations) }
  },
  {
    name: 'pipeline_vars',
    expected_ratio: 0.9,
    run: function() { return run_timed('{range 6000 | map block "{__ | >x || _x | add _x}"}', iterations) }
  },
  {
    name: 'space_vars',
    expected_ratio: 1.4,
    run: function() { return run_timed('{0 | >$acc || range 10000 | each block "{$acc | add __ | >$acc}" || $acc}', iterations) }
  },
  {
    name: 'nested_map',
    expected_ratio: 1.4,
    run: function() { return run_timed('{range 95 | map block "{range 95 | map block "{__ | multiply __in}"}"}', iterations) }
  },
  {
    name: 'space_ship_routing',
    expected_ratio: 6.0,
    run: function() {
      return run_space_timed(`
        outer
          $count 0
          @init from-js
          @out  perf-collect
          stepper {__ | add 1 | >$count}
          check   {$count | less than 1100 | then "{$count | >@loop}" else "{$count | >@done}" | run}
          @init -> stepper -> check
          check.loop -> stepper
          check.done -> @out`,
        function() { return {port: 'init', value: 0} },
        1, iterations)
    }
  },
  {
    name: 'space_subspace_crossing',
    expected_ratio: 1.4,
    run: function() {
      return run_space_timed(`
        inner
          @in
          @out
          transform {__ | multiply 2 | add 1}
          @in -> transform -> @out
        outer
          @init from-js
          @out  perf-collect
          @init -> inner.in
          inner.out -> @out`,
        function(i) { return {port: 'init', value: i} },
        6000, iterations)
    }
  },
  {
    name: 'compiler_stress',
    expected_ratio: 2.5,
    run: function() {
      return run_space_timed(`
        outer
          @init from-js
          @out  perf-collect
          compiler {__ | unquote | run | >@done}
          @init -> compiler
          compiler.done -> @out`,
        function(i) { return {port: 'init', value: '{' + (i + 1) + ' | add 1}'} },
        1000, iterations)
    }
  },
  {
    name: 'compiler_stress_inline',
    expected_ratio: 4.5,
    run: function() { return run_timed('{range 2000 | map block "{"{5 | math add value 7}" | process quote | string transform from :7 to __in | process unquote | run}"}', iterations) }
  },
  {
    name: 'big_data_peek',
    expected_ratio: 1.4,
    run: function() { return run_timed('{process dialect | >$d || range 7000 | map block "{$d | peek (:math :methods :add :params)}" | count}', iterations) }
  },
  {
    name: 'big_data_poke_loop',
    expected_ratio: 6.0,
    run: function() { return run_timed('{(:a (:x 1 :y 2) :b (:x 3 :y 4) :c (:x 5 :y 6)) | >$d || range 240 | each block "{$d | poke (:a :x) value __ | poke (:b :y) value __ | poke (:c :x) value __ | >$d}" || $d}', iterations) }
  },
  // ── Pathfinders (star + par) ────────────────────────────────────────
  {
    name: 'pathfinder_star',
    expected_ratio: 1.2,
    run: function() {
      // Build a big keyed structure from dialect, then hammer it with star paths
      // $d.*.methods gives all method objects; $d.*.methods.*.desc gives all descriptions
      // Also poke with star to mutate all leaves at a level
      return run_timed(
        '{process dialect | >$d' +
        ' || range 200 | each block "{ $d.*.methods.*.desc | count | >$acc }"' +
        ' || range 200 | each block "{ $d.*.methods.*.params | count | >$acc }"' +
        ' || $acc}',
        iterations)
    }
  },
  {
    name: 'pathfinder_star_poke',
    expected_ratio: 1.1,
    run: function() {
      // Repeatedly star-poke all children of a keyed structure (no accumulation — star poke
      // with accumulation causes exponential growth, which is a separate bug to investigate)
      // Must use `list poke path` — the `poke` alias fills `value` not `path`
      return run_timed(
        '{( {* (:a 1 :b 2 :c 3)} {* (:a 4 :b 5 :c 6)} {* (:a 7 :b 8 :c 9)} ) | >$d' +
        ' || range 270 | map block "{$d | list poke path ("*" :a) value __ | list poke path ("*" :b) value __ | list poke path ("*" :c) value __}"' +
        ' | count}',
        iterations)
    }
  },
  {
    name: 'pathfinder_par',
    expected_ratio: 1.4,
    run: function() {
      // Use par (list) pathfinder to peek multiple keys in parallel
      return run_timed(
        '{process dialect | >$d' +
        ' || range 5000 | each block "{$d | peek ((:math :string :list :logic) :methods) | count | >$acc}"' +
        ' || $acc}',
        iterations)
    }
  },
  // ── Named blocks ───────────────────────────────────────────────────
  {
    name: 'named_block_parse',
    expected_ratio: 2.5,
    run: function() {
      // Generate DAML with many distinct named blocks to stress the parser
      // Each {begin}...{end} is a separate template that must be parsed
      var parts = []
      for(var i = 0; i < 300; i++)
        parts.push('{begin b' + i + ' | >$fn}{__ | add ' + i + '}{end b' + i + '}')
      parts.push('{$fn | run value 1}')
      return run_timed(parts.join(''), iterations)
    }
  },
  {
    name: 'named_block_run',
    expected_ratio: 1.7,
    run: function() {
      // Parse one named block, then run it many times via process.run
      return run_timed(
        '{begin tmpl | >$fn}{__ | add 1 | multiply 2 | subtract 3}{end tmpl}' +
        '{range 5000 | map block "{$fn | run value __}"}' +
        ' | count',
        iterations)
    }
  },
  // ── Conditional branching ──────────────────────────────────────────
  {
    name: 'conditional_cond',
    expected_ratio: 1.4,
    run: function() {
      // cond evaluates block conditions until one is truthy — heavier than switch
      return run_timed(
        '{range 4200 | map block "{__ | cond ({__ | mod 3 | not} :fizz {__ | mod 5 | not} :buzz 1 __)}"}',
        iterations)
    }
  },
  {
    name: 'conditional_then_else',
    expected_ratio: 1.0,
    run: function() {
      return run_timed(
        '{range 7000 | map block "{__ | mod 2 | then 1 else 0}"}',
        iterations)
    }
  },
  {
    name: 'conditional_switch',
    expected_ratio: 1.0,
    run: function() {
      // switch scans pairs looking for matching value
      return run_timed(
        '{range 7000 | map block "{__ | mod 4 | switch (0 :zero 1 :one 2 :two 3 :three)}"}',
        iterations)
    }
  },
  // ── Deep nesting ───────────────────────────────────────────────────
  {
    name: 'deep_space_creation',
    expected_ratio: 1.0,
    run: function() {
      // Time how long it takes to create a deeply nested space
      var depth = 350
      return new Promise(function(resolve) {
        var times = []
        var done = 0
        function run_one() {
          var seedlike = make_deep_seedlike(depth)
          var start = performance.now()
          D.make_some_space(seedlike)
          times.push(performance.now() - start)
          done++
          if(done < iterations) run_one()
          else resolve(median(times))
        }
        run_one()
      })
    }
  },
  {
    name: 'deep_space_traversal',
    expected_ratio: 1.0,
    run: function() {
      // Send a ship through many levels of nested spaces and back out
      var depth = 200
      return run_space_timed(
        make_deep_seedlike(depth),
        function() { return {port: 'init', value: 1} },
        1, iterations)
    }
  },
  // ── Error path ─────────────────────────────────────────────────────
  {
    name: 'error_path',
    expected_ratio: 1.0,
    run: function() {
      // Each ship triggers a soft error (division by zero) which routes to @err port.
      // Tests actual error routing through the port system, not just D.on_error returning "".
      // Suppress console.log to avoid flooding output.
      var real_log = console.log
      console.log = function() {}
      return run_space_timed(`
        outer
          @init from-js
          @out  perf-collect
          @err  perf-collect
          badmath {__ | math divide by 0 | add 1 | >@done}
          @init -> badmath
          badmath.done -> @out`,
        function(i) { return {port: 'init', value: i} },
        6000, iterations)
        .then(function(ms) { console.log = real_log; return ms })
    }
  },
  // TODO: wiring rules with pattern matching (once implemented)
]

// ── Deep space seed generator ─────────────────────────────────────────

function make_deep_seedlike(depth) {
  var lines = []
  // innermost space
  lines.push('level0')
  lines.push('  @in')
  lines.push('  @out')
  lines.push('  work {__ | add 1}')
  lines.push('  @in -> work -> @out')
  // each wrapping level
  for(var i = 1; i < depth; i++) {
    lines.push('level' + i)
    lines.push('  @in')
    lines.push('  @out')
    lines.push('  @in -> level' + (i - 1) + '.in')
    lines.push('  level' + (i - 1) + '.out -> @out')
  }
  // outermost space with ports for testing
  lines.push('outer')
  lines.push('  @init from-js')
  lines.push('  @out  perf-collect')
  lines.push('  @init -> level' + (depth - 1) + '.in')
  lines.push('  level' + (depth - 1) + '.out -> @out')
  return lines.join('\n')
}

// ── Run ─────────────────────────────────────────────────────────────

var total_start = performance.now()

console.log('=== Daimio Performance Tests ===')

var cal_ms = await run_timed(calibration_daml, iterations)
console.log('Calibration: ' + cal_ms.toFixed(1) + 'ms (median of ' + iterations + ')\n')

var passed = 0
var failed = 0
var fail_details = []

for(var i = 0; i < benchmarks.length; i++) {
  var b = benchmarks[i]
  var ms = await b.run()
  var ratio = ms / cal_ms
  var limit = b.expected_ratio * threshold_multiplier
  var ok = ratio <= limit

  if(ok) passed++
  else {
    failed++
    fail_details.push(b.name)
  }

  var pad_name = (b.name + '                        ').slice(0, 24)
  var pad_ms = (ms.toFixed(1) + 'ms').padStart(10)
  var pad_ratio = ('ratio ' + ratio.toFixed(2)).padStart(12)
  var pad_limit = ('(limit ' + limit.toFixed(1) + ')').padStart(14)
  console.log('  ' + pad_name + pad_ms + '  ' + pad_ratio + '  ' + pad_limit + '  ' + (ok ? 'PASS' : 'FAIL'))
}

var total_ms = performance.now() - total_start
console.log('\n' + (passed + failed) + ' benchmarks: ' + passed + ' passed, ' + failed + ' failed')
console.log('Completed in ' + (total_ms / 1000).toFixed(1) + 's')

if(failed) {
  console.log('\nFailed: ' + fail_details.join(', '))
  process.exit(1)
}
