import { useMemo } from 'react'
import dagre from 'dagre'
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps
} from '@xyflow/react'
import { Bot, Crown } from 'lucide-react'
import clsx from 'clsx'
import type { AgentDefinition, AgentStatus, TeamDefinition } from '@shared/contracts'
import { roleLabels, statusLabels } from '@shared/contracts'

interface AgentNodeData extends Record<string, unknown> {
  agent: AgentDefinition
  status: AgentStatus
  taskTitle?: string
  progress?: number
}

type AgentFlowNode = Node<AgentNodeData, 'agent'>

function AgentNode({ data, selected }: NodeProps<AgentFlowNode>): React.JSX.Element {
  const { agent, status, taskTitle, progress } = data
  return (
    <div className={clsx('agent-node', `status-${status}`, selected && 'selected')}>
      {agent.role !== 'chief' && <Handle type="target" position={Position.Top} />}
      <div className="agent-node-head">
        <div className="agent-avatar" style={{ color: agent.color, backgroundColor: `${agent.color}18` }}>
          {agent.role === 'chief' ? <Crown size={17} /> : <Bot size={17} />}
        </div>
        <div className="agent-node-title">
          <strong>{agent.name}</strong>
          <span>{roleLabels[agent.role].zh}</span>
        </div>
        <div className="status-chip">
          <i />
          {statusLabels[status].zh}
        </div>
      </div>
      <div className="agent-node-model">{agent.model.modelId || '尚未选择模型'}</div>
      {taskTitle && (
        <div className="agent-task">
          <span>{taskTitle}</span>
          <div className="progress-track"><i style={{ width: `${progress ?? 0}%` }} /></div>
        </div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  )
}

export function AgentTree({
  team,
  statuses = {},
  tasks = {},
  onSelect
}: {
  team: TeamDefinition
  statuses?: Record<string, AgentStatus>
  tasks?: Record<string, { title: string; progress: number }>
  onSelect?: (agentId: string) => void
}): React.JSX.Element {
  const { nodes, edges } = useMemo(() => layoutTree(team, statuses, tasks), [team, statuses, tasks])
  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={{ agent: AgentNode }}
      onNodeClick={(_event, node) => onSelect?.(node.id)}
      fitView
      fitViewOptions={{ padding: 0.18, maxZoom: 1.05 }}
      minZoom={0.45}
      maxZoom={1.4}
      nodesDraggable={false}
      nodesConnectable={false}
      proOptions={{ hideAttribution: true }}
    >
      <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--canvas-dot)" />
      <Controls showInteractive={false} />
      <MiniMap
        pannable
        zoomable
        nodeColor={(node) => (node.data as AgentNodeData).agent.color}
        maskColor="var(--minimap-mask)"
      />
    </ReactFlow>
  )
}

function layoutTree(
  team: TeamDefinition,
  statuses: Record<string, AgentStatus>,
  tasks: Record<string, { title: string; progress: number }>
): { nodes: AgentFlowNode[]; edges: Edge[] } {
  const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  graph.setGraph({ rankdir: 'TB', ranksep: 94, nodesep: 44, marginx: 30, marginy: 30 })
  for (const agent of team.agents) graph.setNode(agent.id, { width: 224, height: tasks[agent.id] ? 124 : 88 })
  for (const agent of team.agents) {
    if (agent.id !== team.chiefAgentId) graph.setEdge(team.chiefAgentId, agent.id)
  }
  dagre.layout(graph)

  const nodes: AgentFlowNode[] = team.agents.map((agent) => {
    const position = graph.node(agent.id) as { x: number; y: number }
    const height = tasks[agent.id] ? 124 : 88
    return {
      id: agent.id,
      type: 'agent',
      position: { x: position.x - 112, y: position.y - height / 2 },
      data: {
        agent,
        status: statuses[agent.id] ?? 'idle',
        taskTitle: tasks[agent.id]?.title,
        progress: tasks[agent.id]?.progress
      }
    }
  })
  const edges: Edge[] = team.agents
    .filter((agent) => agent.id !== team.chiefAgentId)
    .map((agent) => ({
      id: `${team.chiefAgentId}-${agent.id}`,
      source: team.chiefAgentId,
      target: agent.id,
      type: 'smoothstep',
      animated: statuses[agent.id] === 'running',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
      style: { stroke: statuses[agent.id] === 'running' ? '#168A8A' : 'var(--edge-color)', strokeWidth: 1.6 }
    }))
  return { nodes, edges }
}
