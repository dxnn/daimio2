import D from '../daimio/daimio.js'
import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin, output: process.stdout })
let buf = ''

function prompt() {
  rl.question(buf ? '  ' : '> ', line => {
    if (line === '' && buf.trim()) {
      const input = buf
      buf = ''
      return D.run(input, value => {
        console.log(value)
        prompt()
      })
    }
    buf += (buf ? ' ' : '') + line
    prompt()
  })
}

prompt()
