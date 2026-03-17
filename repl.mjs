import D from './daimio/daimio.js'
import { readFileSync } from 'fs'

const errors = []
D.on_error = function(command, error) {
  errors.push(error || command)

  // Route to space's error port if available (same as core on_error, minus console.log)
  var space = D.Etc.active_space
  if(space) {
    for(var i = 0, l = space.ports.length; i < l; i++) {
      var port = space.ports[i]
      if(port.flavour === 'err' && !port.station) {
        port.enter(error || command, D.Etc.active_process || null)
        break
      }
    }
  }

  return ""
}

const RED = '\x1b[31m'
const RESET = '\x1b[0m'

function flush_errors(stream) {
  while (errors.length) stream.write(RED + 'error: ' + errors.shift() + RESET + '\n')
}

const eIdx = process.argv.indexOf('-e')
const fIdx = process.argv.indexOf('-f')
if (eIdx !== -1 && process.argv[eIdx + 1]) {
  D.run(process.argv[eIdx + 1], value => {
    flush_errors(process.stderr)
    console.log(value)
  })
} else if (fIdx !== -1 && process.argv[fIdx + 1]) {
  const daml = readFileSync(process.argv[fIdx + 1], 'utf8')
  D.run(daml, value => {
    flush_errors(process.stderr)
    console.log(value)
  })
} else {
  const { createInterface } = await import('readline')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let buf = ''

  function prompt() {
    rl.question(buf ? '  ' : '> ', line => {
      if (line === '' && buf.trim()) {
        const input = buf
        buf = ''
        return D.run(input, value => {
          flush_errors(process.stderr)
          console.log(value)
          prompt()
        })
      }
      buf += (buf ? ' ' : '') + line
      prompt()
    })
  }

  prompt()
}
