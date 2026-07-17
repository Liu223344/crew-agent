import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { TeamDefinition } from '../shared/contracts'

const modelSchema = z.object({
  connectionId: z.string(),
  modelId: z.string(),
  fallbackConnectionId: z.string().optional(),
  fallbackModelId: z.string().optional(),
  temperature: z.number().min(0).max(2)
})

const agentSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  role: z.enum(['chief', 'research', 'writer', 'designer', 'developer', 'reviewer', 'custom']),
  title: z.string(),
  instructions: z.string(),
  color: z.string(),
  avatar: z.string().optional(),
  model: modelSchema,
  tools: z.array(z.string()),
  outputContract: z.string(),
  budgetLimit: z.number().nonnegative().optional()
})

const teamSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string(),
  name: z.string().min(1),
  description: z.string(),
  chiefAgentId: z.string(),
  agents: z.array(agentSchema).min(1),
  concurrency: z.number().int().min(1).max(8),
  defaultBudget: z.number().nonnegative().optional(),
  createdAt: z.string(),
  updatedAt: z.string()
})

export function exportTeamJson(team: TeamDefinition): string {
  return JSON.stringify({ format: 'bossy-team', version: 1, team }, null, 2)
}

export function importTeamJson(text: string): TeamDefinition {
  const value = JSON.parse(text) as unknown
  const rawTeam = typeof value === 'object' && value !== null && 'team' in value ? (value as { team: unknown }).team : value
  const team = teamSchema.parse(rawTeam)
  if (!team.agents.some((agent) => agent.id === team.chiefAgentId && agent.role === 'chief')) throw new Error('团队模板缺少有效总指挥')
  const ids = new Map(team.agents.map((agent) => [agent.id, randomUUID()]))
  const now = new Date().toISOString()
  return {
    ...team,
    id: randomUUID(),
    chiefAgentId: ids.get(team.chiefAgentId)!,
    agents: team.agents.map((agent) => ({ ...agent, id: ids.get(agent.id)! })),
    createdAt: now,
    updatedAt: now
  }
}

