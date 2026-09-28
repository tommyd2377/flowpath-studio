'use client';

import { useMemo } from 'react';
import { ReactFlow, Background, Controls, Handle, Position, MarkerType, BaseEdge, EdgeLabelRenderer, getSmoothStepPath, type Node, type NodeProps, type Edge, type EdgeProps } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { CatalogDiagram } from './catalog-diagram.js';
import { diagramRelationshipLabel } from './catalog-diagram.js';

type ItemNode = Node<{ label: string; kind: string; active: boolean; select: () => void }, 'publishedItem'>;
function PublishedItem({ data }: NodeProps<ItemNode>) {
  return <><Handle type="target" position={Position.Left}/><button type="button" className="platform-diagram-node nodrag" aria-pressed={data.active} onClick={data.select}><small>{data.kind}</small><strong>{data.label}</strong></button><Handle type="source" position={Position.Right}/></>;
}
const nodeTypes = { publishedItem: PublishedItem };
function PublishedRelationship({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, markerEnd, style, label }: EdgeProps) {
  const [path, x, y] = getSmoothStepPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return <><BaseEdge id={id} path={path} markerEnd={markerEnd} style={style}/><EdgeLabelRenderer><span className="platform-diagram-edge" style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}>{label}</span></EdgeLabelRenderer></>;
}
const edgeTypes = { publishedRelationship: PublishedRelationship };

export default function CatalogDiagramCanvas({ diagram, selectedId, onSelect }: { diagram: CatalogDiagram; selectedId: string; onSelect: (id: string) => void }) {
  const nodes = useMemo<ItemNode[]>(() => {
    const rows = new Map<number, number>();
    return diagram.nodes.map(({ entity, depth }) => {
      const row = rows.get(depth) ?? 0; rows.set(depth, row + 1);
      return { id: entity.id, type: 'publishedItem', position: { x: depth * 420, y: row * 160 },
        data: { label: entity.name, kind: entity.kind, active: selectedId === entity.id, select: () => onSelect(entity.id) } };
    });
  }, [diagram, selectedId, onSelect]);
  const edges = useMemo<Edge[]>(() => diagram.relationships.map(relationship => ({ id: relationship.id, source: relationship.fromEntityId, target: relationship.toEntityId,
    label: relationship.polarity === 'denied' ? `Not: ${relationship.label}` : relationship.label, ariaLabel: diagramRelationshipLabel(relationship), type: 'publishedRelationship',
    style: { stroke: 'var(--platform-accent, #8aad9d)', strokeDasharray: relationship.polarity === 'denied' ? '4 4' : undefined },
    markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--platform-accent, #8aad9d)' } })), [diagram]);
  return <div className="platform-diagram-canvas" role="region" aria-label="Published relationship map">
    <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: .2, maxZoom: 1 }}
      nodesDraggable={false} nodesConnectable={false} nodesFocusable={false} edgesFocusable={false} elementsSelectable={false}
      deleteKeyCode={null} zoomOnScroll={false} zoomOnDoubleClick={false} zoomOnPinch={false} panOnScroll={false} preventScrolling={false} minZoom={.25} maxZoom={1.5}>
      <Background gap={24} size={1} color="var(--platform-line, #ffffff16)"/><Controls showInteractive={false}/>
    </ReactFlow>
  </div>;
}
