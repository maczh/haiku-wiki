import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const cwd = fileURLToPath(new URL('../vendor/pptist/', import.meta.url))
function run(args) {
  const result = spawnSync('npm', args, { cwd, stdio: 'inherit', env: { ...process.env, HUSKY: '0' } })
  if (result.status !== 0) process.exit(result.status || 1)
}
if (!existsSync(`${cwd}node_modules/vite/bin/vite.js`)) run(['ci', '--ignore-scripts', '--no-audit', '--no-fund'])
if (Number(process.versions.node.split('.')[0]) >= 22) run(['run', 'build-only'])
else run(['exec', '--yes', '--package=node@22', '--', 'node', 'node_modules/vite/bin/vite.js', 'build'])
