// Blueprint layout algorithm
// Layering borrowed from dagre Sugiyama framework core ideas, self-implemented.
// Edge routing: adjacent layers use left-right bezier; skip-layer edges arc above/below.

// ── Types ──

export interface LayoutNode {
  id: string
  x: number
  y: number
  width: number
  height: number
  layerIndex: number
}

export interface LayoutEdge {
  from: string
  to: string
  kind: "dependency" | "route"
  route?: string
  pathD: string
  labelX: number
  labelY: number
}

export interface BlueprintLayout {
  nodes: LayoutNode[]
  edges: LayoutEdge[]
  svgWidth: number
  svgHeight: number
}

// ── Constants ──

const NODE_WIDTH = 220
const NODE_HEIGHT = 96
const H_GAP = 60 // horizontal gap between layers
const V_GAP = 28 // vertical gap between nodes in same layer
const LAYER_V_PAD = 40 // vertical padding above/below the whole graph
const SKIP_HIGHWAY_MARGIN = 24 // how far above/below nodes the skip highway sits

// ── Layout algorithm ──

interface RawNode {
  id: string
  deps: string[]
  routes?: Array<{ value: string; targetNodeId: string }>
}

interface RawEdge {
  from: string
  to: string
  kind: "dependency" | "route"
  route?: string
}

/** Layer nodes using topological BFS. Returns array of {id, layerIndex}. */
function layerNodes(nodes: RawNode[], edges: RawEdge[]): Array<{ id: string; layerIndex: number }> {
  const inDegree = new Map<string, number>()
  const idSet = new Set(nodes.map((n) => n.id))

  for (const n of nodes) inDegree.set(n.id, 0)
  for (const e of edges) {
    if (idSet.has(e.to)) {
      inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1)
    }
  }

  const queue: string[] = []
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id)
  }

  const layerMap = new Map<string, number>()

  // BFS: all nodes at the same "distance from root" go to the same layer
  while (queue.length > 0) {
    const id = queue.shift()!
    let maxDepLayer = -1
    for (const e of edges) {
      if (e.to === id && layerMap.has(e.from)) {
        maxDepLayer = Math.max(maxDepLayer, layerMap.get(e.from)!)
      }
    }
    const layerIndex = maxDepLayer + 1
    layerMap.set(id, layerIndex)

    for (const e of edges) {
      if (e.from === id) {
        const deg = (inDegree.get(e.to) ?? 1) - 1
        inDegree.set(e.to, deg)
        if (deg === 0 && !layerMap.has(e.to)) {
          queue.push(e.to)
        }
      }
    }
  }

  // Ensure all nodes get a layer (handle disconnected nodes)
  for (const n of nodes) {
    if (!layerMap.has(n.id)) {
      layerMap.set(n.id, 0)
    }
  }

  return Array.from(layerMap.entries()).map(([id, layerIndex]) => ({ id, layerIndex }))
}

function assignCoordinates(
  nodes: RawNode[],
  edges: RawEdge[],
): { layoutNodes: LayoutNode[]; layers: Map<number, LayoutNode[]> } {
  const layerInfo = layerNodes(nodes, edges)
  const idToNode = new Map(nodes.map((n) => [n.id, n]))
  const layerMap = new Map<string, number>()
  for (const li of layerInfo) layerMap.set(li.id, li.layerIndex)

  // Group nodes by layer
  const layers = new Map<number, LayoutNode[]>()
  for (const li of layerInfo) {
    if (!layers.has(li.layerIndex)) layers.set(li.layerIndex, [])
  }

  // Pre-compute inbound edge counts for sorting (avoid O(E) per comparison)
  const inboundCount = new Map<string, number>()
  for (const e of edges) {
    inboundCount.set(e.to, (inboundCount.get(e.to) ?? 0) + 1)
  }

  for (const [layerIdx, layerNodes] of layers) {
    const sortedIds = layerInfo.filter((l) => l.layerIndex === layerIdx).map((l) => l.id)

    // Sort within layer: nodes with more upstream deps come first (reduce edge crossings)
    sortedIds.sort((a, b) => {
      const aInCount = inboundCount.get(a) ?? 0
      const bInCount = inboundCount.get(b) ?? 0
      return bInCount - aInCount
    })

    for (let i = 0; i < sortedIds.length; i++) {
      const node = idToNode.get(sortedIds[i])
      if (!node) continue
      layers.get(layerIdx)!.push({
        id: node.id,
        x: 0, // placeholder, set below
        y: 0,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        layerIndex: layerIdx,
      })
    }
  }

  // Compute max layer size for centering
  let maxLayerSize = 0
  for (const [, layerNodes] of layers) {
    maxLayerSize = Math.max(maxLayerSize, layerNodes.length)
  }

  // Assign x, y coordinates
  const totalVSpace = maxLayerSize * (NODE_HEIGHT + V_GAP) - V_GAP
  for (const [layerIdx, layerNodes] of layers) {
    const x = layerIdx * (NODE_WIDTH + H_GAP) + H_GAP / 2
    const layerHeight = layerNodes.length * (NODE_HEIGHT + V_GAP) - V_GAP
    const yStart = LAYER_V_PAD + (totalVSpace - layerHeight) / 2

    for (let i = 0; i < layerNodes.length; i++) {
      layerNodes[i].x = x
      layerNodes[i].y = yStart + i * (NODE_HEIGHT + V_GAP)
    }
  }

  return {
    layoutNodes: Array.from(layers.values()).flat(),
    layers,
  }
}

// ── Edge path generation ──

interface Point {
  x: number
  y: number
}

// Right-side exit (adjacent layer edges)
function getSourcePort(node: LayoutNode): Point {
  return { x: node.x + node.width, y: node.y + node.height / 2 }
}

// Left-side entry, distributed along the edge
function getTargetPort(node: LayoutNode, edgeIndex: number, totalInbound: number): Point {
  const spacing = node.height / (totalInbound + 1)
  return { x: node.x, y: node.y + spacing * (edgeIndex + 1) }
}

// Top-center port (skip-layer edges, top routing)
function getTopPort(node: LayoutNode): Point {
  return { x: node.x + node.width / 2, y: node.y }
}

// Bottom-center port (skip-layer edges, bottom routing)
function getBottomPort(node: LayoutNode): Point {
  return { x: node.x + node.width / 2, y: node.y + node.height }
}

/** Adjacent-layer bezier: right-out → left-in. */
function buildAdjacentPath(
  srcPort: Point,
  tgtPort: Point,
): { d: string; labelX: number; labelY: number } {
  const offset = 40
  const x1 = srcPort.x
  const y1 = srcPort.y
  const x2 = tgtPort.x
  const y2 = tgtPort.y

  const cp1x = x1 + offset
  const cp1y = y1
  const cp2x = x2 - offset
  const cp2y = y2

  const d = `M ${x1} ${y1} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${x2} ${y2}`

  // Cubic bezier evaluation at t=0.5
  const t = 0.5
  const mt = 1 - t
  const labelX = mt * mt * mt * x1 + 3 * mt * mt * t * cp1x + 3 * mt * t * t * cp2x + t * t * t * x2
  const labelY = mt * mt * mt * y1 + 3 * mt * mt * t * cp1y + 3 * mt * t * t * cp2y + t * t * t * y2

  return { d, labelX, labelY }
}

/**
 * Skip-layer bezier: single smooth arc above or below intermediate nodes.
 *
 * Top routing:  source top → arc over everything → target top
 * Bottom routing: source bottom → arc under everything → target bottom
 *
 * Control points:
 *   CP1: pull horizontally part-way toward target, vertically toward highway
 *   CP2: symmetrically from target side
 *
 * The arc peak/trough naturally hangs near `highwayY`.
 */
function buildSkipPath(
  srcPort: Point,
  tgtPort: Point,
  highwayY: number,
  useTop: boolean,
): { d: string; labelX: number; labelY: number } {
  const x1 = srcPort.x
  const y1 = srcPort.y
  const x2 = tgtPort.x
  const y2 = tgtPort.y

  const dx = Math.abs(x2 - x1)
  const midX = (x1 + x2) / 2

  // Horizontal pull: how far out the control points reach
  const hPull = Math.min(dx * 0.35, 100)
  // Vertical pull: how strongly the arc bows up/down
  const vPull = Math.max(Math.abs(highwayY - (y1 + y2) / 2) * 1.2, 60)

  const dir = useTop ? -1 : 1
  const cp1y = y1 + dir * vPull
  const cp2y = y2 + dir * vPull

  const d = `M ${x1} ${y1} C ${x1 + hPull} ${cp1y}, ${x2 - hPull} ${cp2y}, ${x2} ${y2}`

  // Label at arc peak/trough
  const peakY = useTop ? highwayY - 10 : highwayY + 16

  return { d, labelX: midX, labelY: peakY }
}

// ── Main layout function ──

interface BlueprintInput {
  nodes: RawNode[]
  edges?: RawEdge[]
}

export function layoutBlueprint(input: BlueprintInput): BlueprintLayout {
  const edges: RawEdge[] = input.edges ?? expandEdgesFrom(input.nodes)

  const { layoutNodes } = assignCoordinates(input.nodes, edges)

  // Build lookups
  const idToLayout = new Map(layoutNodes.map((n) => [n.id, n]))
  const nodeLayerMap = new Map(layoutNodes.map((n) => [n.id, n.layerIndex]))

  // Compute highway Y positions for skip-layer edges
  const minY = layoutNodes.length > 0
    ? Math.min(...layoutNodes.map((n) => n.y))
    : 0
  const maxY = layoutNodes.length > 0
    ? Math.max(...layoutNodes.map((n) => n.y + n.height))
    : NODE_HEIGHT

  // ── Separate edges into adjacent vs skip ──

  // Adjacent edges: target is at most 1 layer ahead of source
  // Skip edges: target is 2+ layers ahead → route above/below

  // Count adjacent inbound edges per node for port distribution
  const adjacentInCount = new Map<string, number>()
  for (const e of edges) {
    const srcLayer = nodeLayerMap.get(e.from) ?? 0
    const tgtLayer = nodeLayerMap.get(e.to) ?? 0
    if (tgtLayer - srcLayer <= 1) {
      adjacentInCount.set(e.to, (adjacentInCount.get(e.to) ?? 0) + 1)
    }
  }

  const seenAdjacentPort = new Map<string, number>()
  const layoutEdges: LayoutEdge[] = []

  for (const e of edges) {
    const src = idToLayout.get(e.from)
    const tgt = idToLayout.get(e.to)
    if (!src || !tgt) continue

    const srcLayer = nodeLayerMap.get(e.from) ?? 0
    const tgtLayer = nodeLayerMap.get(e.to) ?? 0
    const layerDiff = tgtLayer - srcLayer

    if (layerDiff <= 1) {
      // ── Adjacent layer: right-out → left-in bezier ──
      const totalIn = adjacentInCount.get(e.to) ?? 1
      const portKey = e.to
      const edgeIdx = seenAdjacentPort.get(portKey) ?? 0
      seenAdjacentPort.set(portKey, edgeIdx + 1)

      const srcPort = getSourcePort(src)
      const tgtPort = getTargetPort(tgt, edgeIdx, totalIn)
      const pathData = buildAdjacentPath(srcPort, tgtPort)

      layoutEdges.push({
        from: e.from,
        to: e.to,
        kind: e.kind,
        route: e.route,
        pathD: pathData.d,
        labelX: pathData.labelX,
        labelY: pathData.labelY,
      })
    } else {
      // ── Skip layer: top or bottom arc ──
      // Route above if source is positioned above target, below otherwise
      const useTop = src.y <= tgt.y
      const srcPort = useTop ? getTopPort(src) : getBottomPort(src)
      const tgtPort = useTop ? getTopPort(tgt) : getBottomPort(tgt)
      const highwayY = useTop
        ? minY - SKIP_HIGHWAY_MARGIN
        : maxY + SKIP_HIGHWAY_MARGIN

      const pathData = buildSkipPath(srcPort, tgtPort, highwayY, useTop)

      layoutEdges.push({
        from: e.from,
        to: e.to,
        kind: e.kind,
        route: e.route,
        pathD: pathData.d,
        labelX: pathData.labelX,
        labelY: pathData.labelY,
      })
    }
  }

  // Compute SVG dimensions (account for skip-edge highway space)
  const hasSkipEdges = layoutEdges.some(
    (e) => {
      const srcLayer = nodeLayerMap.get(e.from) ?? 0
      const tgtLayer = nodeLayerMap.get(e.to) ?? 0
      return tgtLayer - srcLayer > 1
    }
  )

  const maxNodeX = layoutNodes.length > 0 ? Math.max(...layoutNodes.map((n) => n.x)) + NODE_WIDTH + H_GAP : 400
  const maxNodeY = layoutNodes.length > 0
    ? Math.max(...layoutNodes.map((n) => n.y)) + NODE_HEIGHT + LAYER_V_PAD
    : 300

  // Extra vertical space for skip-edge highways
  const topHighwayPad = hasSkipEdges ? SKIP_HIGHWAY_MARGIN + LAYER_V_PAD : 0
  const bottomHighwayPad = hasSkipEdges ? SKIP_HIGHWAY_MARGIN + LAYER_V_PAD : 0

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    svgWidth: Math.max(400, maxNodeX),
    svgHeight: Math.max(300, maxNodeY + topHighwayPad + bottomHighwayPad),
  }
}

// ── Helper: expand edges from node deps + routes ──

function expandEdgesFrom(nodes: RawNode[]): RawEdge[] {
  const edges: RawEdge[] = []
  for (const node of nodes) {
    for (const dep of node.deps) {
      edges.push({ from: dep, to: node.id, kind: "dependency" })
    }
    if (node.routes) {
      for (const r of node.routes) {
        edges.push({ from: node.id, to: r.targetNodeId, kind: "route", route: r.value })
      }
    }
  }
  return edges
}
