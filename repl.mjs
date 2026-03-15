import D from './daimio/daimio.js'
import { readFileSync } from 'fs'

const eIdx = process.argv.indexOf('-e')
const fIdx = process.argv.indexOf('-f')
if (eIdx !== -1 && process.argv[eIdx + 1]) {
  D.run(process.argv[eIdx + 1], value => {
    console.log(value)
  })
} else if (fIdx !== -1 && process.argv[fIdx + 1]) {
  const daml = readFileSync(process.argv[fIdx + 1], 'utf8')
  D.run(daml, value => {
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
