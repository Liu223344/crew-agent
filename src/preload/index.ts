import { contextBridge, ipcRenderer } from 'electron'
import type { AppSettings, AppSnapshot, BossyApi, CreateRunInput, SaveMcpServerInput, SaveProviderInput, TeamDefinition, UpdateRunTaskInput } from '../shared/contracts'

const api: BossyApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  saveTeam: (team: TeamDefinition) => ipcRenderer.invoke('team:save', team),
  deleteTeam: (teamId: string) => ipcRenderer.invoke('team:delete', teamId),
  createBlankTeam: () => ipcRenderer.invoke('team:create'),
  saveProvider: (provider: SaveProviderInput) => ipcRenderer.invoke('provider:save', provider),
  testProvider: (providerId: string) => ipcRenderer.invoke('provider:test', providerId),
  saveMcpServer: (server: SaveMcpServerInput) => ipcRenderer.invoke('mcp:save', server),
  testMcpServer: (serverId: string) => ipcRenderer.invoke('mcp:test', serverId),
  deleteMcpServer: (serverId: string) => ipcRenderer.invoke('mcp:delete', serverId),
  exportTeam: (teamId: string) => ipcRenderer.invoke('team:export', teamId),
  importTeam: () => ipcRenderer.invoke('team:import'),
  createRun: (input: CreateRunInput) => ipcRenderer.invoke('run:create', input),
  approveRun: (runId: string) => ipcRenderer.invoke('run:approve', runId),
  setRunStatus: (runId: string, status: 'paused' | 'running' | 'cancelled') =>
    ipcRenderer.invoke('run:status', runId, status),
  resolveApproval: (runId: string, approvalId: string, decision: 'approved' | 'rejected') =>
    ipcRenderer.invoke('run:approval', runId, approvalId, decision),
  sendRunMessage: (runId: string, agentId: string, content: string) => ipcRenderer.invoke('run:message', runId, agentId, content),
  updateRunTask: (runId: string, taskId: string, patch: UpdateRunTaskInput) => ipcRenderer.invoke('run:task:update', runId, taskId, patch),
  openDirectory: () => ipcRenderer.invoke('directory:open'),
  openAttachments: () => ipcRenderer.invoke('attachments:open'),
  exportData: () => ipcRenderer.invoke('data:export'),
  importData: () => ipcRenderer.invoke('data:import'),
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke('settings:save', settings),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: AppSnapshot): void => listener(snapshot)
    ipcRenderer.on('snapshot:changed', handler)
    return () => ipcRenderer.removeListener('snapshot:changed', handler)
  }
}

contextBridge.exposeInMainWorld('bossy', api)
