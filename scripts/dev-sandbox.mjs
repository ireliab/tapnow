// Runs a throwaway TapLocal instance (own data dir, no API keys → mock models only)
// on ports 5180/8790, so testing never touches real projects or paid providers.
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const env = {
  ...process.env,
  TAPLOCAL_DATA: process.env.TAPLOCAL_DATA ?? path.join(root, '.sandbox'),
  API_PORT: process.env.API_PORT ?? '8790',
  WEB_PORT: process.env.WEB_PORT ?? '5180',
}
console.log(`sandbox data: ${env.TAPLOCAL_DATA} · web http://localhost:${env.WEB_PORT}`)
const child = spawn('npm', ['run', 'dev'], { cwd: root, env, stdio: 'inherit', shell: true })
child.on('exit', code => process.exit(code ?? 0))
