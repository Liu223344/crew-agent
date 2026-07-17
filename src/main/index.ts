import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { AppSettings, CreateRunInput, SaveMcpServerInput, SaveProviderInput, TeamDefinition, UpdateRunTaskInput } from '../shared/contracts'
import { BossyDatabase } from './database'
import { RunEngine } from './run-engine'
import { ProviderService } from './providers/provider-service'
import { McpService } from './mcp/mcp-service'
import { exportTeamJson, importTeamJson } from './team-transfer'

let mainWindow: BrowserWindow | null = null
let database: BossyDatabase
let runEngine: RunEngine
let providerService: ProviderService
let mcpService: McpService
const planningControllers = new Map<string, AbortController>()

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 940,
    minWidth: 1120,
    minHeight: 720,
    show: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#F3F5F1',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerIpc(): void {
  ipcMain.handle('snapshot:get', () => database.snapshot())
  ipcMain.handle('team:save', (_event, team: TeamDefinition) => {
    database.saveTeam(team)
    return database.snapshot()
  })
  ipcMain.handle('team:delete', (_event, teamId: string) => {
    database.deleteTeam(teamId)
    return database.snapshot()
  })
  ipcMain.handle('team:create', () => {
    database.saveTeam(database.makeBlankTeam())
    return database.snapshot()
  })
  ipcMain.handle('provider:save', (_event, provider: SaveProviderInput) => {
    database.saveProvider(provider)
    return database.snapshot()
  })
  ipcMain.handle('provider:test', async (_event, providerId: string) => {
    const result = await providerService.probe(providerId)
    mainWindow?.webContents.send('snapshot:changed', database.snapshot())
    return result
  })
  ipcMain.handle('mcp:save', (_event, server: SaveMcpServerInput) => {
    database.saveMcpServer(server)
    return database.snapshot()
  })
  ipcMain.handle('mcp:test', async (_event, serverId: string) => {
    const result = await mcpService.probe(serverId)
    mainWindow?.webContents.send('snapshot:changed', database.snapshot())
    return result
  })
  ipcMain.handle('mcp:delete', async (_event, serverId: string) => {
    await mcpService.close(serverId)
    database.deleteMcpServer(serverId)
    return database.snapshot()
  })
  ipcMain.handle('team:export', async (_event, teamId: string) => {
    const team = database.snapshot().teams.find((item) => item.id === teamId)
    if (!team) throw new Error('Team not found')
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: `${team.name}.bossy-team.json`, filters: [{ name: 'Bossy Team', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, exportTeamJson(team), 'utf8')
    return result.filePath
  })
  ipcMain.handle('team:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: 'Bossy Team', extensions: ['json'] }] })
    if (result.canceled) return null
    const stat = await fs.stat(result.filePaths[0])
    if (stat.size > 2_000_000) throw new Error('团队模板超过 2 MB 限制')
    database.saveTeam(importTeamJson(await fs.readFile(result.filePaths[0], 'utf8')))
    return database.snapshot()
  })
  ipcMain.handle('data:export', async () => {
    const snapshot = database.snapshot()
    const data = {
      ...snapshot,
      providers: snapshot.providers.map((provider) => ({ ...provider, hasSecret: false, status: 'unconfigured' as const })),
      mcpServers: snapshot.mcpServers.map((server) => ({ ...server, hasSecret: false, status: 'unconfigured' as const }))
    }
    const result = await dialog.showSaveDialog(mainWindow!, { defaultPath: 'Bossy-backup.json', filters: [{ name: 'Bossy Backup', extensions: ['json'] }] })
    if (result.canceled || !result.filePath) return null
    await fs.writeFile(result.filePath, JSON.stringify({ format: 'bossy-backup', version: 1, exportedAt: new Date().toISOString(), data }, null, 2), 'utf8')
    return result.filePath
  })
  ipcMain.handle('data:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile'], filters: [{ name: 'Bossy Backup', extensions: ['json'] }] })
    if (result.canceled) return null
    const stat = await fs.stat(result.filePaths[0])
    if (stat.size > 20_000_000) throw new Error('备份文件超过 20 MB 限制')
    const parsed = JSON.parse(await fs.readFile(result.filePaths[0], 'utf8')) as { format?: string; data?: unknown }
    if (parsed.format !== 'bossy-backup' || !parsed.data || typeof parsed.data !== 'object') throw new Error('不是有效的 Bossy 备份')
    const data = parsed.data as ReturnType<BossyDatabase['snapshot']>
    for (const team of data.teams ?? []) database.saveTeam(team)
    for (const run of data.runs ?? []) database.saveRun(run)
    for (const provider of data.providers ?? []) {
      const { hasSecret: _hasSecret, updatedAt: _updatedAt, ...input } = provider
      database.saveProvider({ ...input, status: 'unconfigured' })
    }
    for (const server of data.mcpServers ?? []) {
      const { hasSecret: _hasSecret, updatedAt: _updatedAt, ...input } = server
      database.saveMcpServer({ ...input, status: 'unconfigured' })
    }
    if (data.settings) database.saveSettings(data.settings)
    return database.snapshot()
  })
  ipcMain.handle('run:create', async (_event, input: CreateRunInput) => {
    const team = database.snapshot().teams.find((item) => item.id === input.teamId)
    if (!team) throw new Error('Team not found')
    const requestId = input.requestId ?? randomUUID()
    const controller = new AbortController()
    planningControllers.set(requestId, controller)
    try {
      return await runEngine.create(input, team, controller.signal)
    } finally {
      planningControllers.delete(requestId)
    }
  })
  ipcMain.handle('run:planning:cancel', (_event, requestId: string) => planningControllers.get(requestId)?.abort())
  ipcMain.handle('run:approve', (_event, runId: string) => runEngine.approve(runId))
  ipcMain.handle('run:status', (_event, runId: string, status: 'paused' | 'running' | 'cancelled') =>
    runEngine.setStatus(runId, status)
  )
  ipcMain.handle('run:approval', (_event, runId: string, approvalId: string, decision: 'approved' | 'rejected') =>
    runEngine.resolveApproval(runId, approvalId, decision)
  )
  ipcMain.handle('run:message', (_event, runId: string, agentId: string, content: string) => runEngine.sendMessage(runId, agentId, content))
  ipcMain.handle('run:task:update', (_event, runId: string, taskId: string, patch: UpdateRunTaskInput) => runEngine.updateTask(runId, taskId, patch))
  ipcMain.handle('directory:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('attachments:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openFile', 'multiSelections'] })
    return result.canceled ? [] : result.filePaths
  })
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    database.saveSettings(settings)
    return database.snapshot()
  })
}

app.whenReady().then(() => {
  app.setName('Bossy')
  database = new BossyDatabase()
  database.recoverInterruptedRuns()
  providerService = new ProviderService(database)
  mcpService = new McpService(database)
  runEngine = new RunEngine(database, providerService, mcpService, () => mainWindow)
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  void mcpService?.closeAll()
})
