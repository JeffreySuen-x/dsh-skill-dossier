import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const scratch = mkdtempSync(join(tmpdir(), 'dsh-skill-manager-pack-'))

function runNpm(args, options = {}) {
  if (process.platform === 'win32') {
    return execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', 'npm.cmd', ...args], options)
  }
  return execFileSync('npm', args, options)
}

try {
  const packOutput = runNpm([
    'pack', '--json', '--pack-destination', scratch, '--cache', join(scratch, 'npm-cache'),
  ], { cwd: new URL('..', import.meta.url), encoding: 'utf8' })
  const packed = JSON.parse(packOutput)[0]
  if (packed?.filename === undefined) throw new Error('npm pack did not return a tarball filename')
  const tarball = join(scratch, packed.filename)
  const installRoot = join(scratch, 'install')
  runNpm([
    'install', '--prefix', installRoot, '--ignore-scripts', '--no-audit', '--no-fund', '--legacy-peer-deps',
    '--cache', join(scratch, 'npm-cache'), tarball,
  ], { stdio: 'pipe' })

  const packageRoot = join(installRoot, 'node_modules', 'dsh-skill-manager')
  const required = [
    'LICENSE', 'README.md', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/client.js.map', 'lib/types/index.d.ts',
  ]
  for (const relative of required) {
    if (!existsSync(join(packageRoot, relative))) throw new Error(`tarball missing ${relative}`)
  }
  if (existsSync(join(installRoot, 'node_modules', '@deepseek-ai', 'dsh-report'))) {
    throw new Error('tarball unexpectedly installed the legacy dsh-report package')
  }

  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
  if (manifest.dependencies?.['@deepseek-ai/dsh-report'] !== undefined) {
    throw new Error('manifest still depends on the legacy dsh-report package')
  }

  const plugin = await import(pathToFileURL(join(packageRoot, 'lib', 'index.js')).href)
  const routes = new Map()
  const services = new Map([
    ['skills', { list: async () => [], get: async () => undefined, register: () => () => undefined }],
    ['tools', { register: () => () => undefined }],
    ['webServer', { register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) } }],
    ['agents', { get: () => undefined }],
    ['fs', { resolve: async (value) => value, readText: async () => '', listDir: async () => [], writeText: async () => undefined }],
    ['shell', { resolve: (value) => value, run: async () => ({ exitCode: 0 }) }],
    ['sandboxPolicy', { workspaceRoot: scratch, resolve: () => ({}) }],
  ])
  plugin.apply({ get: (name) => services.get(name), effect: (setup) => { setup() } })
  const actualRoutes = [...routes.keys()].sort()
  const expectedRoutes = ['/api/report', '/api/skill-manager']
  if (JSON.stringify(actualRoutes) !== JSON.stringify(expectedRoutes)) {
    throw new Error(`installed plugin routes ${JSON.stringify(actualRoutes)}, expected ${JSON.stringify(expectedRoutes)}`)
  }
  console.log(`pack smoke PASS: ${packed.filename}; routes=${actualRoutes.join(',')}`)
} finally {
  rmSync(scratch, { recursive: true, force: true })
}
