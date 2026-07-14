// Run all test suites in sequence.
// Usage: node tests/run_all.mjs
//
// Every suite must pass. A suite that exits non-zero is a failure.

import { execFileSync } from 'child_process'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const verbose = process.argv.includes('-v')
const dir = dirname(fileURLToPath(import.meta.url))

const suites = [
  ['d2_spec_test.mjs',     'spec alignment'],
  ['daimio_test.mjs',      'legacy suite'],
  ['node_code.mjs',        'internal JS-level'],
  ['security_test.mjs',    'dialect, pollution, regex, senders'],
  ['space_test.mjs',       'space/topology'],
  ['det_test.mjs',         'determinism (isolation/replay/scheduler)'],
  ['det_sender_test.mjs',  'determinism (sender/dialect I2/I3/I4)'],
  ['det_world_test.mjs',   'determinism (world-I/O: emit/round-trip)'],
  ['det_time_test.mjs',    'determinism (time/clock via D.now)'],
  ['det_blackhole_test.mjs','determinism (black-hole crossing)'],
  ['det_socket_test.mjs',  'determinism (socket-load)'],
  ['space_ascii_test.mjs', 'ASCII topology renderer'],
  ['example_test.mjs',     'command examples (auto-discovered)'],
  ['perf_test.mjs',        'performance benchmarks'],
  ['editor_test.mjs',      'editor module (tokens, context, completions)'],
]

let passed = 0
let failed = 0
const failures = []

for (const [file, label] of suites) {
  const path = join(dir, file)
  if (verbose) console.log(`\n── ${label} ──`)
  else process.stdout.write(`  ${label} ... `)
  try {
    const stdio = verbose ? 'inherit' : ['ignore', 'pipe', 'pipe']
    execFileSync('node', [path], { stdio, timeout: 120000 })
    if (!verbose) console.log('ok')
    passed++
  } catch (e) {
    if (!verbose) console.log('FAIL')
    else console.log(`\n*** ${file} FAILED ***`)
    if (!verbose && e.stdout) process.stdout.write(e.stdout)
    if (!verbose && e.stderr) process.stderr.write(e.stderr)
    failed++
    failures.push(file)
  }
}

console.log(`\n${suites.length} suites: ${passed} passed, ${failed} failed`)
if (failures.length) {
  console.log('Failed: ' + failures.join(', '))
  process.exit(1)
}
