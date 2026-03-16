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
      test(label, example[0], example[1])
    }
  }
}

all_registered = true
if (pending === 0) report()
