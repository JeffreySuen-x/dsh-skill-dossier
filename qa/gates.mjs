#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const pnpm = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const requested = new Set((process.env.GATES ?? 'test,typecheck,build,pack').split(',').filter(Boolean))
const gates = [
  ['test', [pnpm, 'test']],
  ['typecheck', [pnpm, 'run', 'typecheck']],
  ['build', [pnpm, 'run', 'build']],
  ['pack', [process.execPath, 'scripts/pack-smoke.mjs']],
]

let passed = 0
const failed = []
console.log('== gates: dsh-skill-manager ==')
for (const [name, [command, ...args]] of gates) {
  if (!requested.has(name)) continue
  const executable = process.platform === 'win32' && command.endsWith('.cmd')
    ? process.env.ComSpec ?? 'cmd.exe'
    : command
  const executableArgs = executable === command ? args : ['/d', '/s', '/c', command, ...args]
  const result = spawnSync(executable, executableArgs, {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status === 0) {
    console.log(`GATE ${name} PASS`)
    passed += 1
    continue
  }
  console.log(`GATE ${name} FAIL (exit ${String(result.status)})`)
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n')
  if (output !== '') console.log(output)
  failed.push(name)
}

console.log(`GATES RESULT: PASS=${passed} FAIL=${failed.length}`)
if (failed.length > 0) {
  console.log(`FAILED_GATES: ${failed.join(',')}`)
  process.exitCode = 1
}
