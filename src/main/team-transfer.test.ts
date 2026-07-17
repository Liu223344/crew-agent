import { describe, expect, it } from 'vitest'
import type { TeamDefinition } from '../shared/contracts'
import { exportTeamJson, importTeamJson } from './team-transfer'

const team: TeamDefinition = {
  schemaVersion: 1,
  id: 'team-1',
  name: 'Portable team',
  description: 'No secrets',
  chiefAgentId: 'chief-1',
  concurrency: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  agents: [{
    id: 'chief-1',
    name: 'Chief',
    role: 'chief',
    title: 'Chief',
    instructions: 'Plan',
    color: '#000000',
    model: { connectionId: 'openai', modelId: 'model', temperature: 0.3 },
    tools: [],
    outputContract: 'Plan JSON'
  }]
}

describe('team transfer', () => {
  it('exports without provider secrets and imports with fresh ids', () => {
    const text = exportTeamJson(team)
    expect(text).not.toContain('apiKey')
    const imported = importTeamJson(text)
    expect(imported.id).not.toBe(team.id)
    expect(imported.chiefAgentId).not.toBe(team.chiefAgentId)
    expect(imported.name).toBe(team.name)
  })

  it('rejects a team without a chief', () => {
    const invalid = { ...team, chiefAgentId: 'missing' }
    expect(() => importTeamJson(JSON.stringify(invalid))).toThrow(/总指挥/)
  })
})

