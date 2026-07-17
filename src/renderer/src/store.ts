import { create } from 'zustand'
import type {
  AgentDefinition,
  AppSettings,
  AppSnapshot,
  CreateRunInput,
  ExecutionRun,
  McpProbeResult,
  ProviderProbeResult,
  SaveMcpServerInput,
  SaveProviderInput,
  TeamDefinition,
  UpdateRunTaskInput
} from '@shared/contracts'

export type AppPage = 'dashboard' | 'team' | 'runs' | 'providers'

interface AppStore {
  snapshot: AppSnapshot | null
  page: AppPage
  selectedTeamId: string | null
  selectedAgentId: string | null
  selectedRunId: string | null
  loading: boolean
  initialize: () => Promise<() => void>
  setPage: (page: AppPage) => void
  selectTeam: (teamId: string) => void
  selectAgent: (agentId: string | null) => void
  selectRun: (runId: string | null) => void
  saveTeam: (team: TeamDefinition) => Promise<void>
  createTeam: () => Promise<void>
  deleteTeam: (teamId: string) => Promise<void>
  saveProvider: (provider: SaveProviderInput) => Promise<void>
  testProvider: (providerId: string) => Promise<ProviderProbeResult>
  saveMcpServer: (server: SaveMcpServerInput) => Promise<void>
  testMcpServer: (serverId: string) => Promise<McpProbeResult>
  deleteMcpServer: (serverId: string) => Promise<void>
  exportTeam: (teamId: string) => Promise<string | null>
  importTeam: () => Promise<void>
  exportData: () => Promise<string | null>
  importData: () => Promise<void>
  createRun: (input: CreateRunInput) => Promise<ExecutionRun>
  approveRun: (runId: string) => Promise<void>
  setRunStatus: (runId: string, status: 'paused' | 'running' | 'cancelled') => Promise<void>
  resolveApproval: (runId: string, approvalId: string, decision: 'approved' | 'rejected') => Promise<void>
  sendRunMessage: (runId: string, agentId: string, content: string) => Promise<void>
  updateRunTask: (runId: string, taskId: string, patch: UpdateRunTaskInput) => Promise<void>
  saveSettings: (settings: AppSettings) => Promise<void>
  addAgent: (team: TeamDefinition, agent: AgentDefinition) => Promise<void>
}

export const useAppStore = create<AppStore>((set, get) => ({
  snapshot: null,
  page: 'dashboard',
  selectedTeamId: null,
  selectedAgentId: null,
  selectedRunId: null,
  loading: true,

  initialize: async () => {
    const snapshot = await window.bossy.getSnapshot()
    set({
      snapshot,
      selectedTeamId: snapshot.teams[0]?.id ?? null,
      selectedRunId: snapshot.runs[0]?.id ?? null,
      loading: false
    })
    return window.bossy.onSnapshot((next) => {
      const state = get()
      set({
        snapshot: next,
        selectedTeamId: next.teams.some((team) => team.id === state.selectedTeamId)
          ? state.selectedTeamId
          : (next.teams[0]?.id ?? null),
        selectedRunId: next.runs.some((run) => run.id === state.selectedRunId)
          ? state.selectedRunId
          : (next.runs[0]?.id ?? null)
      })
    })
  },

  setPage: (page) => set({ page }),
  selectTeam: (selectedTeamId) => set({ selectedTeamId, selectedAgentId: null }),
  selectAgent: (selectedAgentId) => set({ selectedAgentId }),
  selectRun: (selectedRunId) => set({ selectedRunId }),

  saveTeam: async (team) => set({ snapshot: await window.bossy.saveTeam(team) }),
  createTeam: async () => {
    const snapshot = await window.bossy.createBlankTeam()
    set({ snapshot, selectedTeamId: snapshot.teams[0]?.id ?? null, page: 'team' })
  },
  deleteTeam: async (teamId) => {
    const snapshot = await window.bossy.deleteTeam(teamId)
    set({ snapshot, selectedTeamId: snapshot.teams[0]?.id ?? null, selectedAgentId: null })
  },
  saveProvider: async (provider) => set({ snapshot: await window.bossy.saveProvider(provider) }),
  testProvider: async (providerId) => {
    const result = await window.bossy.testProvider(providerId)
    set({ snapshot: await window.bossy.getSnapshot() })
    return result
  },
  saveMcpServer: async (server) => set({ snapshot: await window.bossy.saveMcpServer(server) }),
  testMcpServer: async (serverId) => {
    const result = await window.bossy.testMcpServer(serverId)
    set({ snapshot: await window.bossy.getSnapshot() })
    return result
  },
  deleteMcpServer: async (serverId) => set({ snapshot: await window.bossy.deleteMcpServer(serverId) }),
  exportTeam: (teamId) => window.bossy.exportTeam(teamId),
  importTeam: async () => {
    const snapshot = await window.bossy.importTeam()
    if (snapshot) set({ snapshot, selectedTeamId: snapshot.teams[0]?.id ?? null, page: 'team' })
  },
  exportData: () => window.bossy.exportData(),
  importData: async () => {
    const snapshot = await window.bossy.importData()
    if (snapshot) set({ snapshot })
  },
  createRun: async (input) => {
    const run = await window.bossy.createRun(input)
    set({ snapshot: await window.bossy.getSnapshot(), selectedRunId: run.id, page: 'runs' })
    return run
  },
  approveRun: async (runId) => {
    await window.bossy.approveRun(runId)
    set({ snapshot: await window.bossy.getSnapshot() })
  },
  setRunStatus: async (runId, status) => {
    await window.bossy.setRunStatus(runId, status)
    set({ snapshot: await window.bossy.getSnapshot() })
  },
  resolveApproval: async (runId, approvalId, decision) => {
    await window.bossy.resolveApproval(runId, approvalId, decision)
    set({ snapshot: await window.bossy.getSnapshot() })
  },
  sendRunMessage: async (runId, agentId, content) => {
    await window.bossy.sendRunMessage(runId, agentId, content)
    set({ snapshot: await window.bossy.getSnapshot() })
  },
  updateRunTask: async (runId, taskId, patch) => {
    await window.bossy.updateRunTask(runId, taskId, patch)
    set({ snapshot: await window.bossy.getSnapshot() })
  },
  saveSettings: async (settings) => set({ snapshot: await window.bossy.saveSettings(settings) }),
  addAgent: async (team, agent) => {
    await get().saveTeam({ ...team, agents: [...team.agents, agent] })
    set({ selectedAgentId: agent.id })
  }
}))
