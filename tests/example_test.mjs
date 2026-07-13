// Example tests — runs all [input, expected] examples from command definitions
// Run with: node tests/example_test.mjs

var D = (await import('../daimio/daimio.js')).default

var pass = 0
var fail = 0
var failures = []
var pending = 0
var all_registered = false
var reported = false

function test(label, input, expected) {
  pending++
  D.run(input, function(output) {
    var actual = D.execute_then_stringify(output)
    if (actual === false) actual = ''
    if (typeof actual !== 'string') actual = JSON.stringify(actual) || ''

    if (actual.trim() === expected.trim()) {
      pass++
    } else {
      fail++
      failures.push({ label, input, expected, actual: actual.trim() })
    }
    pending--
    if (all_registered && pending === 0) report()
  })
}

function report() {
  if (reported) return
  reported = true

  console.log(`\n${pass + fail} examples, ${pass} passed, ${fail} failed`)

  if (failures.length) {
    console.log('\nFailures:')
    for (var f of failures) {
      console.log(`  ${f.label}`)
      console.log(`    input:    ${f.input}`)
      console.log(`    expected: ${f.expected}`)
      console.log(`    actual:   ${f.actual}`)
    }
    process.exit(1)
  }
}

// Wired examples: effectful commands can't run in the bare execution
// space (unwired invocations sploot [effectful-unwired-sploot]), so a
// three-element example [input, expected, handler_daml] runs in a fixture
// space whose wiring rule routes the command's requests to the handler.
var wired_seq = 0
var wired_expectations = {}
D.import_port_flavour('example-collect', {
  dir: 'out',
  outside_exit: function(ship) {
    var exp = wired_expectations[this.settings.thing]
    if (!exp) return
    delete wired_expectations[this.settings.thing]
    var actual = ship
    if (actual === false) actual = ''
    if (typeof actual !== 'string') actual = JSON.stringify(actual) || ''
    if (actual.trim() === exp.expected.trim()) pass++
    else {
      fail++
      failures.push({ label: exp.label, input: exp.input, expected: exp.expected, actual: actual.trim() })
    }
    pending--
    if (all_registered && pending === 0) report()
  }
})

function wired_test(label, input, expected, handler_daml, portType) {
  pending++
  var key = 'wx' + (++wired_seq)
  wired_expectations[key] = { label: label, input: input, expected: expected }
  try {
    var seed = 'outer\n'
             + '  @go from-js\n'
             + '  @out example-collect ' + key + '\n'
             + '  caller ' + input + '\n'
             + '  handler ' + handler_daml + '\n'
             + '  caller@cmd:' + portType.slice(4) + ' <-> handler\n'
             + '  @go -> caller -> @out\n'
    var space = new D.Space(D.make_some_space(seed))
    D.send_value_to_js_port(space, 'go', 'x')
  } catch(e) {
    fail++
    failures.push({ label: label, input: input, expected: expected, actual: 'fixture threw: ' + e.message })
    delete wired_expectations[key]
    pending--
  }
}

// Walk D.Commands and run every [input, expected] example
for (var handler_key in D.Commands) {
  var handler = D.Commands[handler_key]
  var methods = handler.methods || {}
  for (var method_key in methods) {
    var method = methods[method_key]
    if (!method.examples) continue
    for (var example of method.examples) {
      if (!Array.isArray(example) || example.length < 2) continue
      var label = `${handler_key} ${method_key}`
      if (example.length >= 3 && method.effect) {
        wired_test(label, example[0], example[1], example[2], method.effect.portType)
        continue
      }
      test(label, example[0], example[1])
    }
  }
}

all_registered = true
if (pending === 0) report()
