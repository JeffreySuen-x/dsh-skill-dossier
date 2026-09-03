import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

describe('committed client artifact', () => {
  it('does not embed the checkout directory in CSS module identities', () => {
    const repositoryRoot = fileURLToPath(new URL('..', import.meta.url)).replaceAll('\\', '/')
    const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8').replaceAll('\\', '/')

    expect(client).not.toContain(repositoryRoot)
    expect(client).toContain('dsh-css:src/client/Panel.module.css.mjs')
  })
})
