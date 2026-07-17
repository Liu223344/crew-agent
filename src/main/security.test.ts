import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('desktop security boundaries', () => {
  it('keeps Node disabled and the renderer sandboxed', async () => {
    const source = await readFile(new URL('./index.ts', import.meta.url), 'utf8')
    expect(source).toContain('sandbox: true')
    expect(source).toContain('contextIsolation: true')
    expect(source).toContain('nodeIntegration: false')
  })

  it('exposes only the Bossy API instead of Electron primitives', async () => {
    const source = await readFile(new URL('../preload/index.ts', import.meta.url), 'utf8')
    expect(source).toContain("contextBridge.exposeInMainWorld('bossy', api)")
    expect(source).not.toContain("exposeInMainWorld('electron'")
    expect(source).not.toMatch(/exposeInMainWorld\([^,]+,\s*ipcRenderer/)
  })

  it('refuses plaintext secret storage', async () => {
    const source = await readFile(new URL('./database.ts', import.meta.url), 'utf8')
    expect(source).toContain('safeStorage.encryptString')
    expect(source).not.toContain("Buffer.from(input.apiKey")
    expect(source).not.toContain("Buffer.from(input.authToken")
  })
})

