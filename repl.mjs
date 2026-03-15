import D from '../daimio/daimio.js'

const eIdx = process.argv.indexOf('-e')
if (eIdx !== -1 && process.argv[eIdx + 1]) {
  D.run(process.argv[eIdx + 1], value => {
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
