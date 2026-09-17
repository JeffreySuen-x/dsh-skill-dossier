#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
/** 本地工具一律用 `node <入口>` 直接跑，不经过 pnpm：`pnpm/setup` 只把 pnpm 注入
 * 工作流自己的 shell PATH，`spawnSync('pnpm')` 在 Windows runner 上找不到它，
 * 于是 test/typecheck/build 三个闸门全都以「'pnpm.cmd' is not recognized」失败
 * （每个只耗时约 1 秒，因为根本没跑）。同 package.json 的 scripts，改一处要同步。 */
const gate = (entry, args = []) => [process.execPath, [entry, ...args]]
const requested = new Set((process.env.GATES ?? 'test,typecheck,build,pack').split(',').filter(Boolean))
const gates = [
  ['test', gate('node_modules/vitest/vitest.mjs', ['run'])],
  ['typecheck', gate('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json', '--noEmit'])],
  ['build', gate('node_modules/typescript/bin/tsc', ['-p', 'tsconfig.json']), gate('node_modules/tsdown/dist/run.mjs')],
  ['pack', gate('scripts/pack-smoke.mjs')],
]

let passed = 0
const failed = []
const known = gates.map(([name]) => name)
// `GATES` 里出现未知名字（拼错）时不能静默「零闸门全绿」——闸门脚本自己必须先失败。
const unknown = [...requested].filter((name) => !known.includes(name))
if (unknown.length > 0) {
  console.log(`未知闸门名：${unknown.join(',')}（可用：${known.join(',')}）`)
  process.exitCode = 1
} else {
  console.log('== gates: dsh-skill-dossier ==')
  for (const [name, ...steps] of gates) {
    if (!requested.has(name)) continue
    let failure
    for (const [command, args] of steps) {
      const result = spawnSync(command, args, { cwd: root, encoding: 'utf8' })
      if (result.status === 0) continue
      failure = result
      break
    }
    if (failure === undefined) {
      console.log(`GATE ${name} PASS`)
      passed += 1
      continue
    }
    // spawn 失败（例如工具没装）时 status 是 null，只有 result.error 说得清原因。
    const why = failure.error === undefined ? `exit ${String(failure.status)}` : String(failure.error.message ?? failure.error)
    console.log(`GATE ${name} FAIL (${why})`)
    const output = `${failure.stdout ?? ''}\n${failure.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n')
    if (output !== '') console.log(output)
    failed.push(name)
  }

  console.log(`GATES RESULT: PASS=${passed} FAIL=${failed.length}`)
  if (failed.length > 0) {
    console.log(`FAILED_GATES: ${failed.join(',')}`)
    process.exitCode = 1
  }
}
