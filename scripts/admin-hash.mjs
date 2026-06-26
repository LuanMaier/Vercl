import { createHash } from 'crypto'
import { createInterface } from 'readline'

const rl = createInterface({ input: process.stdin, output: process.stdout })

rl.question('Senha para gerar hash: ', (answer) => {
  const hash = createHash('sha256').update(answer).digest('hex')
  console.log('\nCole no .env.local:\n')
  console.log(`VITE_ADMIN_PASSWORD_HASH=${hash}`)
  rl.close()
})
