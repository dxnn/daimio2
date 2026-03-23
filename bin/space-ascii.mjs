import D from '../daimio/daimio.js'
import { render_all } from '../daimio/space_ascii.js'
import { readFileSync } from 'fs'

var eIdx = process.argv.indexOf('-e')
var fIdx = process.argv.indexOf('-f')

if (eIdx !== -1 && process.argv[eIdx + 1]) {
  var seedlikes = D.seedlikes_from_string(process.argv[eIdx + 1])
  console.log(render_all(seedlikes))

} else if (fIdx !== -1 && process.argv[fIdx + 1]) {
  var text = readFileSync(process.argv[fIdx + 1], 'utf8')
  var seedlikes = D.seedlikes_from_string(text)
  console.log(render_all(seedlikes))

} else {
  // Interactive mode
  var createInterface = (await import('readline')).createInterface
  var rl = createInterface({ input: process.stdin, output: process.stdout })
  var buf = ''
  var blank = 0

  function prompt() {
    rl.question(buf ? '  ' : '> ', function(line) {
      if (line === '') {
        blank++
        if (blank >= 2 && buf.trim()) {
          var seedlikes = D.seedlikes_from_string(buf)
          console.log(render_all(seedlikes))
          buf = ''
          blank = 0
        }
      } else {
        blank = 0
        buf += (buf ? '\n' : '') + line
      }
      prompt()
    })
  }
  prompt()
}
