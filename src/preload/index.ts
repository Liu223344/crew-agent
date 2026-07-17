import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, AppSnapshot, BossyApi, CreateRunInput, SaveProviderInput, TeamDefinition } from '../shared/contracts'

const api: BossyApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  saveTeam: (team: TeamDefinition) => ipcRenderer.invoke('team:save', team),
  deleteTeam: (teamId: string) => ipcRenderer.invoke('team:delete', teamId),
  createBlankTeam: () => ipcRenderer.invoke('team:create'),
  saveProvider: (provider: SaveProviderInput) => ipcRenderer.invoke('provider:save', provider),
  createRun: (input: CreateRunInput) => ipcRenderer.invoke('run:create', input),
  approveRun: (runId: string) => ipcRenderer.invoke('run:approve', runId),
  setRunStatus: (runId: string, status: 'paused' | 'running' | 'cancelled') =>
    ipcRenderer.invoke('run:status', runId, status),
  openDirectory: () => ipcRenderer.invoke('directory:open'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => listener(snapshot)
    ipcRenderer.on('snapshot:changed', handler)
    return () => ipcRenderer.removeListener('snapshot:changed', handler)
  }
}

contextBridge.exposeInMainWorld('bossy', api)

