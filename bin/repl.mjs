import D from './daimio/daimio.js'
import { readFileSync, appendFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

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

  function completer(line) {
    // Find the last unclosed { to get the current command context
    var depth = 0, start = -1
    for (var i = line.length - 1; i >= 0; i--) {
      if (line[i] === '}') depth++
      else if (line[i] === '{') { if (depth) depth--; else { start = i; break } }
    }
    if (start === -1) return [[], line]

    var inside = line.slice(start + 1)
    // Strip leading pipes to get current segment
    var raw_seg = inside.split(/\|/).pop()
    var seg = raw_seg.trimStart()
    var words = seg.split(/\s+/).filter(Boolean)

    var handlers = Object.keys(D.Commands)
    var aliases = Object.keys(D.Aliases)

    if (words.length === 0) {
      // Just opened { or just after |
      var all = handlers.concat(aliases).sort()
      return [all, '']
    }

    var handler = words[0]
    if (words.length === 1 && !seg.endsWith(' ')) {
      // Partial handler/alias name
      var all = handlers.concat(aliases).sort()
      var hits = all.filter(c => c.startsWith(handler))
      return [hits, handler]
    }

    var cmd = D.Commands[handler]
    if (!cmd) return [[], '']

    var methods = Object.keys(cmd.methods || {})
    var method_name = words[1]

    if (words.length === 1 || (words.length === 2 && !seg.endsWith(' '))) {
      // Complete method name
      var partial = method_name || ''
      var hits = methods.filter(m => m.startsWith(partial))
      return [hits, partial]
    }

    var method = (cmd.methods || {})[method_name]
    if (!method || !method.params) return [[], '']

    // Complete param names
    var param_names = method.params.map(p => p.key)
    var partial = seg.endsWith(' ') ? '' : words[words.length - 1]
    var hits = param_names.filter(p => p.startsWith(partial))
    return [hits, partial]
  }

  const history_path = join(homedir(), '.daimio_history')
  var history = []
  try { history = readFileSync(history_path, 'utf8').split('\n').filter(Boolean).reverse() } catch(e) {}

  const rl = createInterface({ input: process.stdin, output: process.stdout, completer, history })
  let buf = ''

  function prompt() {
    rl.question(buf ? '  ' : '> ', line => {
      if (line === '' && buf.trim()) {
        const input = buf
        buf = ''
        appendFileSync(history_path, input + '\n')
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
