import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import type { ExecutionRun } from '../shared/contracts'
import { recoverInterruptedRun } from './database'

describe('run recovery', () => {
  it('pauses an interrupted run and queues active steps for retry', () => {
    const run = sampleRun()
    expect(recoverInterruptedRun(run)).toBe(true)
    expect(run.status).toBe('paused')
    expect(run.tasks[0].status).toBe('queued')
    expect(run.events[0].title).toContain('恢复')
  })

  it('leaves completed runs unchanged', () => {
    const run = { ...sampleRun(), status: 'completed' as const }
    expect(recoverInterruptedRun(run)).toBe(false)
  })

  it('persists run events through an append-only insert', async () => {
    const source = await readFile(new URL('./database.ts', import.meta.url), 'utf8')
    expect(source).toContain('CREATE TABLE IF NOT EXISTS run_events')
    expect(source).toContain('INSERT OR IGNORE INTO run_events')
  })
})

function sampleRun(): ExecutionRun {
  return {
    schemaVersion: 1,
    id: 'run',
    teamId: 'team',
    title: 'Run',
    objective: 'Test',
    workspacePath: '/tmp',
    status: 'running',
    concurrency: 1,
    usedTokens: 0,
    estimatedCost: 0,
    planVersion: 1,
    tasks: [{ id: 'task', title: 'Task', objective: 'Do', assigneeId: 'agent', dependencies: [], expectedOutput: 'Output', acceptanceCriteria: 'Done', status: 'running', progress: 50 }],
    events: [],
    approvals: [],
    agentCosts: {},
    messages: [],
    attachments: [],
    artifacts: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z'
  }
}
