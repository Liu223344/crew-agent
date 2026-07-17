import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { AttachmentRecord } from '../shared/contracts'

export async function prepareAttachments(sourcePaths: string[], workspacePath: string): Promise<AttachmentRecord[]> {
  if (sourcePaths.length === 0) return []
  if (!workspacePath) throw new Error('添加附件时必须先选择工作目录')
  if (sourcePaths.length > 20) throw new Error('单个任务最多添加 20 个附件')
  const destination = join(workspacePath, '.bossy', 'attachments')
  await fs.mkdir(destination, { recursive: true })
  const records: AttachmentRecord[] = []
  for (const [index, sourcePath] of sourcePaths.entries()) {
    const stat = await fs.stat(sourcePath)
    if (!stat.isFile()) throw new Error(`附件不是文件：${sourcePath}`)
    if (stat.size > 50_000_000) throw new Error(`附件超过 50 MB：${basename(sourcePath)}`)
    const name = `${String(index + 1).padStart(2, '0')}-${sanitizeName(basename(sourcePath))}`
    const target = join(destination, name)
    await fs.copyFile(sourcePath, target)
    const content = await fs.readFile(target)
    records.push({ name: basename(sourcePath), path: target, type: mimeType(target), size: stat.size, sha256: createHash('sha256').update(content).digest('hex') })
  }
  return records
}

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-160) || 'attachment'
}

export function mimeType(path: string): string {
  return ({ '.pdf': 'application/pdf', '.json': 'application/json', '.md': 'text/markdown', '.txt': 'text/plain', '.csv': 'text/csv', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' } as Record<string, string>)[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

