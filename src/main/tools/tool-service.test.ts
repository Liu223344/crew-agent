import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { safeWorkspacePath, ToolService } from './tool-service'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ToolService workspace safety', () => {
  it('reads files inside the workspace and rejects traversal', async () => {
    const root = await workspace()
    await writeFile(join(root, 'notes.txt'), 'Bossy notes')
    const service = new ToolService()
    await expect(service.execute('read_file', { path: 'notes.txt' }, { workspacePath: root })).resolves.toBe('Bossy notes')
    await expect(safeWorkspacePath(root, '../outside.txt', true)).rejects.toThrow(/超出任务工作目录/)
  })

  it('rejects a symlink that escapes the workspace', async () => {
    const root = await workspace()
    const outside = await mkdtemp(join(tmpdir(), 'bossy-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.txt'), 'secret')
    await symlink(outside, join(root, 'escape'))
    await expect(safeWorkspacePath(root, 'escape/secret.txt', false)).rejects.toThrow(/超出任务工作目录/)
  })

  it('marks writes and terminal commands for explicit approval', () => {
    const service = new ToolService()
    expect(service.approval('write_file', { path: 'report.md', content: 'done' })).toMatchObject({ risk: 'write' })
    expect(service.approval('run_command', { command: 'npm test' })).toMatchObject({ risk: 'terminal' })
    expect(service.approval('read_file', { path: 'report.md' })).toBeUndefined()
  })

  it('blocks URL access to local addresses', async () => {
    const service = new ToolService()
    await expect(service.execute('fetch_url', { url: 'http://127.0.0.1:3000/private' }, { workspacePath: '/tmp' })).rejects.toThrow(/私有网络/)
  })
})

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'bossy-workspace-'))
  roots.push(root)
  await mkdir(join(root, 'sub'))
  return root
}

