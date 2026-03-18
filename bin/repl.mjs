import D from '../daimio/daimio.js'
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
const CYAN = '\x1b[36m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const BLUE = '\x1b[34m'
const MAGENTA = '\x1b[35m'
const BOLD = '\x1b[1m'
const RESET = '\x1b[0m'

function flush_errors(stream) {
  while (errors.length) stream.write(RED + 'error: ' + errors.shift() + RESET + '\n')
}

// DAML syntax highlighting — ANSI escape passthrough must be first in alternation
const DAML_TOKEN = /\x1b\[[0-9;]*[A-Za-z]|"(?:[^"\\]|\\.)*"|[{}]|\|\||[|]|>@\w+|>\$\w+(?:\.\w+)*|\$\w+(?:\.\w+)*|>\w+|__in\b|__\b|_\w+|:\w+|\b\d+(?:\.\d+)?/g

function highlight(s) {
  return s.replace(DAML_TOKEN, function(m) {
    if (m[0] === '\x1b') return m
    if (m[0] === '"') return GREEN + m + RESET
    if (m === '{' || m === '}') return CYAN + m + RESET
    if (m === '||') return BOLD + YELLOW + m + RESET
    if (m === '|') return YELLOW + m + RESET
    if (m.startsWith('>@')) return RED + m + RESET
    if (m.startsWith('>$')) return BOLD + MAGENTA + m + RESET
    if (m[0] === '$') return MAGENTA + m + RESET
    if (m[0] === '>' && m.length > 1) return BOLD + BLUE + m + RESET
    if (m === '__in' || m === '__') return BOLD + BLUE + m + RESET
    if (m[0] === '_') return BLUE + m + RESET
    if (m[0] === ':') return GREEN + m + RESET
    if (m[0] >= '0' && m[0] <= '9') return YELLOW + m + RESET
    return m
  })
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
      if (hits.length === 1) hits = [hits[0] + ' ']
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
      if (hits.length === 1) hits = [hits[0] + ' ']
      return [hits, partial]
    }

    var method = (cmd.methods || {})[method_name]
    if (!method || !method.params) return [[], '']

    // Complete param names
    var param_names = method.params.map(p => p.key)
    var partial = seg.endsWith(' ') ? '' : words[words.length - 1]
    var hits = param_names.filter(p => p.startsWith(partial))
    if (hits.length === 1) hits = [hits[0] + ' ']
    return [hits, partial]
  }

  const history_path = join(homedir(), '.daimio_history')
  var history = []
  try { history = readFileSync(history_path, 'utf8').split('\n').filter(Boolean).reverse() } catch(e) {}

  const rl = createInterface({ input: process.stdin, output: process.stdout, completer, history })
  rl._writeToOutput = function(str) { rl.output.write(highlight(str)) }
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
