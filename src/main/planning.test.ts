import { describe, expect, it } from 'vitest'
import type { PlanTask, TeamDefinition } from '../shared/contracts'
import { createExecutionPlan, groupTasksByDependency } from './planning'

const team: TeamDefinition = {
  schemaVersion: 1,
  id: 'team',
  name: 'Test team',
  description: '',
  chiefAgentId: 'chief',
  concurrency: 3,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  agents: [
    {
      id: 'chief',
      name: 'Chief',
      role: 'chief',
      title: 'Chief of Staff',
      instructions: '',
      color: '#000000',
      model: { connectionId: 'openai', modelId: '', temperature: 0.3 },
      tools: [],
      outputContract: ''
    },
    {
      id: 'worker',
      name: 'Worker',
      role: 'custom',
      title: 'Specialist',
      instructions: 'Do the specialist task.',
      color: '#000000',
      model: { connectionId: 'openai', modelId: '', temperature: 0.3 },
      tools: [],
      outputContract: 'A handoff artifact.'
    }
  ]
}

describe('planning', () => {
  it('creates a brief, worker task, and final review', () => {
    const tasks = createExecutionPlan(team)
    expect(tasks).toHaveLength(3)
    expect(tasks[0].assigneeId).toBe('chief')
    expect(tasks[1].assigneeId).toBe('worker')
    expect(tasks[2].dependencies).toEqual([tasks[1].id])
  })

  it('groups independent tasks in the same execution wave', () => {
    const tasks = createExecutionPlan({ ...team, agents: [...team.agents, { ...team.agents[1], id: 'worker-2', name: 'Worker 2' }] })
    const groups = groupTasksByDependency(tasks)
    expect(groups.map((group) => group.length)).toEqual([1, 2, 1])
  })

  it('rejects cyclic plans', () => {
    const cyclic: PlanTask[] = [
      { id: 'a', title: 'A', objective: '', assigneeId: 'chief', dependencies: ['b'], expectedOutput: '', acceptanceCriteria: '', status: 'queued', progress: 0 },
      { id: 'b', title: 'B', objective: '', assigneeId: 'worker', dependencies: ['a'], expectedOutput: '', acceptanceCriteria: '', status: 'queued', progress: 0 }
    ]
    expect(() => groupTasksByDependency(cyclic)).toThrow(/cycle/)
  })
})

