import { join } from 'node:path'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { AppSettings, CreateRunInput, SaveProviderInput, TeamDefinition } from '../shared/contracts'
import { BossyDatabase } from './database'
import { RunEngine } from './run-engine'

let mainWindow: BrowserWindow | null = null
let database: BossyDatabase
let runEngine: RunEngine

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
  ipcMain.handle('run:create', (_event, input: CreateRunInput) => {
    const team = database.snapshot().teams.find((item) => item.id === input.teamId)
    if (!team) throw new Error('Team not found')
    return runEngine.create(input, team)
  })
  ipcMain.handle('run:approve', (_event, runId: string) => runEngine.approve(runId))
  ipcMain.handle('run:status', (_event, runId: string, status: 'paused' | 'running' | 'cancelled') =>
    runEngine.setStatus(runId, status)
  )
  ipcMain.handle('directory:open', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, { properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : result.filePaths[0]
  })
  ipcMain.handle('settings:save', (_event, settings: AppSettings) => {
    database.saveSettings(settings)
    return database.snapshot()
  })
}

app.whenReady().then(() => {
  app.setName('Bossy')
  database = new BossyDatabase()
  runEngine = new RunEngine(database, () => mainWindow)
  registerIpc()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
