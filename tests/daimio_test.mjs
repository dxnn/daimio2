// Node version of the daimio.html test suite
// Run with: node tests/daimio_test.mjs
//
// Reads tests/daimio.dm, executes Daimio code and checks assertions.
// Ported from the browser-based test runner in tests/daimio.html.

import { readFileSync } from 'fs'

var D = (await import('../daimio/daimio.js')).default

var data = readFileSync(new URL('daimio.dm', import.meta.url), 'utf8')

// these globals are kind of a hack...
var lines = data.split(/\n/).reverse()
var starttime = new Date().getTime()
var win = 0
var lose = 0
var mode = 'text'
var block_name = ''
var code_value = ''
var code_string = ''
var failures = []

function eat_line(value, prior_starter) {
  var whitespace='', wscount=0
    , line = lines.pop()

  /*
    There's four modes:
    - text, which just displays regular text based on whitespace and other factors
    - code, which is a single line of code
    - block, which is a big block of code
    - assert, the value the code should process to
  */

  // mode switcher
  if(mode != 'block') {
    if(/^\s*\{begin /.test(line)) {
      code_string = ''
      block_name = line.match(/^\s*\{begin (\w+)/)[1]
      mode = 'block' // begin a block
    }
    else if(mode == 'code') {
      mode = 'assert' // switch to assert
    }
    else if(/^\s*\{/.test(line)) {
      code_string = line
      mode = 'code' // begin a line of code
    }
    else if(mode == 'assert') {
      mode = 'text' // switch back to text
    }
  }

  // continue the block
  if(mode == 'block') {
    code_string += "\n" + line

    // end the block
    if(new RegExp("\{end " + block_name + '\}').test(line)) {
      mode = 'code'
    }
  }

  // handle code
  if(mode == 'code') {
    code_string = code_string.replace(/^\s+|\s+$/g, '')

    code_value = D.execute_then_stringify(
                   D.ExecutionSpace.execute(
                     D.Parser.string_to_block_segment(code_string), null, prior_starter))
    return code_value
  }

  // handle asserts
  if(mode == 'assert') {
    if(code_value === false) {
      code_value = ''
    }

    if(typeof(code_value) != 'string') {
      code_value = JSON.stringify(code_value) ? JSON.stringify(code_value) : ''
    }

    if(code_value.trim() === line.trim()) {
      win++
    } else {
      lose++
      failures.push({code: code_string, expected: line.trim(), actual: code_value.trim()})
    }
  }

  return true
}

function done() {
  var endtime = new Date().getTime()

  console.log('\n=== Daimio Test Suite ===')
  console.log('Completed ' + (win + lose) + ' tests in ' + ((endtime - starttime) / 1000) + ' seconds.')
  console.log(win + ' passed, ' + lose + ' failed')

  if(lose) {
    console.log('\nFAILURES:')
    failures.forEach(function(f) {
      console.log('  Code:     ' + f.code)
      console.log('  Expected: ' + f.expected)
      console.log('  Actual:   ' + f.actual)
      console.log('')
    })
  }

  if(!lose) console.log('\nYou win!')

  if(lose) process.exit(1)
}

D.data_trampoline(lines, eat_line, D.string_concat, function() {}, done)
