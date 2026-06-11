import { useState, useRef, useCallback, type MouseEvent } from "react"
import { BlueprintFlow, type BlueprintData } from "./BlueprintFlow"

// ── Types ──

interface BlueprintPreviewPanelProps {
  blueprint: BlueprintData
}

// ── Styles ──

const panelContainerStyle: React.CSSProperties = {
  width: "50%",
  minWidth: 280,
  maxWidth: "75%",
  display: "flex",
  flexDirection: "column",
  borderLeft: "1px solid var(--line)",
  background: "var(--panel)",
  position: "relative",
  flexShrink: 0,
}

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  padding: "0 10px",
  height: 36,
  borderBottom: "1px solid var(--line)",
  flexShrink: 0,
}

const headerInfoStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--muted)",
  fontFamily: "JetBrains Mono, monospace",
}

const titleStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 600,
  color: "var(--text)",
}

const resizerStyle: React.CSSProperties = {
  position: "absolute",
  left: 0,
  top: 0,
  bottom: 0,
  width: 4,
  cursor: "col-resize",
  zIndex: 2,
}

export function BlueprintPreviewPanel({ blueprint }: BlueprintPreviewPanelProps) {
  const [widthPct, setWidthPct] = useState(50)
  const containerRef = useRef<HTMLDivElement>(null)
  const [resizing, setResizing] = useState(false)
  const [selectedNodeId, setSelectedNodeId] = useState<string>()

  const handleResizeStart = useCallback(
    (e: MouseEvent) => {
      e.preventDefault()
      setResizing(true)
      const startX = e.clientX
      const startPct = widthPct

      const onMove = (ev: globalThis.MouseEvent) => {
        const parent = containerRef.current?.parentElement
        if (!parent) return
        const parentWidth = parent.getBoundingClientRect().width
        if (parentWidth <= 0) return
        const deltaPx = startX - ev.clientX
        const deltaPct = (deltaPx / parentWidth) * 100
        setWidthPct(Math.max(20, Math.min(75, startPct + deltaPct)))
      }
      const onUp = () => {
        setResizing(false)
        document.removeEventListener("mousemove", onMove)
        document.removeEventListener("mouseup", onUp)
      }

      document.addEventListener("mousemove", onMove)
      document.addEventListener("mouseup", onUp)
    },
    [widthPct],
  )

  const nodeCount = blueprint.nodes.length
  const edgeCount = blueprint.nodes.reduce(
    (sum, n) =>
      sum +
      (n.deps?.length ?? 0) +
      (n.routes?.length ?? 0),
    0,
  )

  return (
    <div
      ref={containerRef}
      style={{ ...panelContainerStyle, width: `${widthPct}%` }}
      className={resizing ? "select-none" : ""}
    >
      {/* Resize handle */}
      <div style={resizerStyle} onMouseDown={handleResizeStart} />

      {/* Header - same height as chat top bar */}
      <div style={headerStyle}>
        <span style={titleStyle}>Blueprint Preview</span>
        <span style={headerInfoStyle}>
          {blueprint.title} · {nodeCount} node{nodeCount !== 1 ? "s" : ""} ·{" "}
          {edgeCount} edge{edgeCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Flow */}
      <div style={{ flex: 1, minHeight: 0 }}>
        <BlueprintFlow
          blueprint={blueprint}
          selectedNodeId={selectedNodeId}
          onNodeClick={setSelectedNodeId}
        />
      </div>
    </div>
  )
}
