import { useMemo, useState, useCallback, useRef, useEffect, type MouseEvent, type WheelEvent } from "react"
import { BlueprintNodeCard, type BlueprintNodeData } from "./BlueprintNodeCard"
import { layoutBlueprint } from "../lib/blueprint-layout"

// ── Types ──

export interface BlueprintData {
  version: string
  title: string
  description?: string
  nodes: BlueprintNodeData[]
}

interface BlueprintFlowProps {
  blueprint: BlueprintData
  selectedNodeId?: string
  onNodeClick?: (nodeId: string) => void
}

// ── Styles ──

const containerStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  height: "100%",
  overflow: "hidden",
  cursor: "grab",
  background: `radial-gradient(circle, rgba(142,163,179,0.15) 1px, transparent 1px)`,
  backgroundSize: "20px 20px",
  backgroundColor: "var(--bg)",
}

const routeLabelStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: "JetBrains Mono, monospace",
  fill: "#32d7ba",
  fontWeight: 600,
  pointerEvents: "none",
  userSelect: "none",
}


// ── Flow animation keyframes ──

const FLOW_STYLE = `
@keyframes bp-flow {
  from { stroke-dashoffset: 24; }
  to   { stroke-dashoffset: 0; }
}
.bp-edge-flow {
  fill: none;
  stroke-width: 2;
  stroke-dasharray: 6 18;
  animation: bp-flow 2s linear infinite;
}
.bp-edge-flow-route {
  stroke-dasharray: 5 19;
  animation-duration: 1.6s;
}
`

export function BlueprintFlow({ blueprint, selectedNodeId, onNodeClick }: BlueprintFlowProps) {
  const [translate, setTranslate] = useState({ x: 20, y: 20 })
  const [scale, setScale] = useState(1)
  const scaleRef = useRef(1)
  const [isDragging, setIsDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null)

  // Compute layout from blueprint data
  const layout = useMemo(() => {
    return layoutBlueprint({
      nodes: blueprint.nodes.map((n) => ({
        id: n.id,
        deps: n.deps ?? [],
        routes: n.routes,
      })),
    })
  }, [blueprint])

  // Build node map for lookup
  const nodeMap = useMemo(() => {
    const map = new Map<string, BlueprintNodeData>()
    for (const n of blueprint.nodes) {
      map.set(n.id, n)
    }
    return map
  }, [blueprint])

  // ── Mouse handlers ──

  const handleMouseDown = useCallback((e: MouseEvent) => {
    if ((e.target as HTMLElement).closest("[data-blueprint-node]")) return
    setIsDragging(true)
    dragStart.current = { x: e.clientX - translate.x, y: e.clientY - translate.y }
  }, [translate])

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (!isDragging) return
      setTranslate({
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      })
    },
    [isDragging],
  )

  const handleMouseUp = useCallback(() => {
    setIsDragging(false)
  }, [])

  // Use native wheel event with passive: false to allow preventDefault
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      if (!rect) return
      const mouseX = e.clientX - rect.left
      const mouseY = e.clientY - rect.top

      const delta = e.deltaY > 0 ? -0.08 : 0.08
      const prevScale = scaleRef.current
      const newScale = Math.max(0.3, Math.min(2.0, prevScale + delta))
      const ratio = newScale / prevScale

      scaleRef.current = newScale
      setScale(newScale)
      setTranslate((prev) => ({
        x: mouseX - ratio * (mouseX - prev.x),
        y: mouseY - ratio * (mouseY - prev.y),
      }))
    }

    el.addEventListener("wheel", handleWheel, { passive: false })
    return () => el.removeEventListener("wheel", handleWheel)
  }, [])

  // Reset transform when blueprint changes
  const resetKey = `${blueprint.title}|${blueprint.nodes.length}`
  useEffect(() => {
    setTranslate({ x: 20, y: 20 })
    setScale(1)
    scaleRef.current = 1
  }, [resetKey])

  return (
    <div
      ref={containerRef}
      style={containerStyle}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    >
      {/* Flow animation style */}
      <style>{FLOW_STYLE}</style>

      {/* SVG layer: edges */}
      <svg
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 0,
        }}
      >
        <g transform={`translate(${translate.x}, ${translate.y}) scale(${scale})`}>
          {layout.edges.map((edge, i) => {
            const isHovered =
              hoveredNodeId === edge.from || hoveredNodeId === edge.to
            const isSelected =
              selectedNodeId === edge.from || selectedNodeId === edge.to

            const isRoute = edge.kind === "route"

            // Color scheme: --live (#32d7ba) for selected flow, grays for default
            let bgColor: string
            let flowColor: string

            if (isRoute) {
              bgColor = isSelected ? "#1a6b5a" : isHovered ? "#2dd4a8" : "#1a6b5a"
              flowColor = isSelected ? "#32d7ba" : isHovered ? "#32d7ba" : "#2dd4a8"
            } else {
              bgColor = isSelected ? "#2a3a4a" : isHovered ? "#2a3a4a" : "#2a3a4a"
              flowColor = isSelected ? "#32d7ba" : isHovered ? "#6b8a9e" : "#4a5e6d"
            }

            return (
              <g key={`edge-${i}`}>
                {/* Background solid line */}
                <path
                  d={edge.pathD}
                  fill="none"
                  strokeWidth={2}
                  stroke={bgColor}
                  style={{ transition: "stroke 0.15s ease" }}
                />
                {/* Animated flow line */}
                <path
                  d={edge.pathD}
                  className={`bp-edge-flow ${isRoute ? "bp-edge-flow-route" : ""}`}
                  stroke={flowColor}
                  style={{ transition: "stroke 0.15s ease" }}
                />
                {isRoute && edge.route && (
                  <text
                    x={edge.labelX}
                    y={edge.labelY - 6}
                    textAnchor="middle"
                    style={{
                      ...routeLabelStyle,
                      fill: isSelected ? "#5eead4" : isHovered ? "#32d7ba" : "#2dd4a8",
                    }}
                  >
                    {edge.route}
                  </text>
                )}
              </g>
            )
          })}
        </g>
      </svg>

      {/* HTML layer: nodes */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        <div
          style={{
            position: "absolute",
            transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale})`,
            transformOrigin: "0 0",
          }}
        >
          {layout.nodes.map((layoutNode) => {
            const node = nodeMap.get(layoutNode.id)
            if (!node) return null
            const isSel = selectedNodeId === layoutNode.id
            const isHov = hoveredNodeId === layoutNode.id

            return (
              <div
                key={layoutNode.id}
                data-blueprint-node={layoutNode.id}
                style={{ pointerEvents: "auto" }}
                onClick={() => onNodeClick?.(layoutNode.id)}
                onMouseEnter={() => setHoveredNodeId(layoutNode.id)}
                onMouseLeave={() => setHoveredNodeId(null)}
              >
                <BlueprintNodeCard
                  node={node}
                  x={layoutNode.x}
                  y={layoutNode.y}
                  width={layoutNode.width}
                  height={layoutNode.height}
                  isSelected={isSel}
                  isHighlighted={isHov}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
