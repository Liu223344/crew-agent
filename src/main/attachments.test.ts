import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { prepareAttachments } from './attachments'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('task attachments', () => {
  it('copies selected files into the workspace and records a content hash', async () => {
    const sourceRoot = await temp('bossy-source-')
    const workspace = await temp('bossy-workspace-')
    const source = join(sourceRoot, 'brief.md')
    await writeFile(source, '# Brief')
    const [record] = await prepareAttachments([source], workspace)
    expect(record.name).toBe('brief.md')
    expect(record.type).toBe('text/markdown')
    expect(record.sha256).toHaveLength(64)
    await expect(readFile(record.path, 'utf8')).resolves.toBe('# Brief')
  })

  it('requires a workspace when attachments are present', async () => {
    await expect(prepareAttachments(['/tmp/file'], '')).rejects.toThrow(/工作目录/)
  })
})

async function temp(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

