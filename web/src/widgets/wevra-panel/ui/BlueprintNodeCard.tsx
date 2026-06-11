import { memo } from "react"

// ── Types ──

export interface BlueprintNodeData {
  id: string
  name: string
  role: "planner" | "coder" | "tester" | "reviewer" | "operator"
  agentId?: string
  instruction: string
  type: "task" | "router"
  deps: string[]
  routes?: Array<{ value: string; targetNodeId: string }>
  lane?: "main" | "branch"
}

interface BlueprintNodeCardProps {
  node: BlueprintNodeData
  x: number
  y: number
  width: number
  height: number
  isSelected?: boolean
  isHighlighted?: boolean
}

// ── Role color map ──

const ROLE_COLORS: Record<string, { bg: string; text: string }> = {
  planner: { bg: "rgba(167,139,250,0.15)", text: "#a78bfa" },
  coder: { bg: "rgba(52,211,153,0.15)", text: "#34d399" },
  tester: { bg: "rgba(251,191,36,0.15)", text: "#fbbf24" },
  reviewer: { bg: "rgba(96,165,250,0.15)", text: "#60a5fa" },
  operator: { bg: "rgba(244,114,182,0.15)", text: "#f472b6" },
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  return text.slice(0, maxLen - 3) + "..."
}

export const BlueprintNodeCard = memo(function BlueprintNodeCard({
  node,
  x,
  y,
  width,
  height,
  isSelected,
  isHighlighted,
}: BlueprintNodeCardProps) {
  const roleColor = ROLE_COLORS[node.role] ?? ROLE_COLORS.coder
  const borderColor = isSelected
    ? "var(--live)"
    : isHighlighted
      ? "rgba(50,215,186,0.4)"
      : "#29414f"
  const bg = isSelected
    ? "rgba(18,31,38,0.98)"
    : "rgba(13,22,28,0.95)"

  const instructionPreview = truncate(node.instruction, 55)

  return (
    <div
      title={node.instruction}
      style={{
        position: "absolute",
        left: x,
        top: y,
        width,
        height,
        background: bg,
        border: `1px solid ${borderColor}`,
        cursor: "default",
        transition: "border-color 0.15s ease, background-color 0.15s ease",
        fontFamily: "inherit",
      }}
    >
      {/* Lane indicator for branch nodes */}
      {node.lane === "branch" && (
        <div
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: "rgba(142,163,179,0.3)",
          }}
        />
      )}

      {/* Header: id + role badge */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "6px 8px 2px",
          gap: 4,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--text)",
            fontFamily: "JetBrains Mono, monospace",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            flex: 1,
          }}
        >
          {node.id}
        </span>
        <span
          style={{
            fontSize: 9,
            fontWeight: 600,
            padding: "1px 5px",
            background: roleColor.bg,
            color: roleColor.text,
            whiteSpace: "nowrap",
            textTransform: "uppercase",
          }}
        >
          {node.role}
        </span>
      </div>

      {/* Name */}
      <div
        style={{
          padding: "0 8px 2px",
          fontSize: 10,
          color: "var(--muted)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {node.name}
      </div>

      {/* Instruction preview */}
      <div
        style={{
          padding: "4px 8px",
          fontSize: 10,
          color: "rgba(142,163,179,0.7)",
          lineHeight: 1.35,
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          wordBreak: "break-word",
        }}
      >
        {instructionPreview}
      </div>

      {/* Footer: type icon + deps count + router info */}
      <div
        style={{
          position: "absolute",
          bottom: 4,
          left: 8,
          right: 8,
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontSize: 9,
          color: "rgba(142,163,179,0.5)",
        }}
      >
        {node.type === "router" ? (
          <span
            style={{
              fontFamily: "JetBrains Mono, monospace",
              color: "rgba(96,165,250,0.6)",
            }}
          >
            {'<R>'}
          </span>
        ) : (
          <span style={{ color: "rgba(142,163,179,0.4)" }}>&#9632;</span>
        )}
        {node.deps.length > 0 && (
          <span>{node.deps.length} dep{node.deps.length > 1 ? "s" : ""}</span>
        )}
        {node.type === "router" && node.routes && (
          <span style={{ marginLeft: "auto", fontFamily: "JetBrains Mono, monospace" }}>
            {node.routes.map((r) => r.value).join(" | ")}
          </span>
        )}
        {node.agentId && (
          <span style={{ marginLeft: 4, opacity: 0.6, fontStyle: "italic", overflow: "hidden", textOverflow: "ellipsis" }}>
            {truncate(node.agentId, 12)}
          </span>
        )}
      </div>
    </div>
  )
})
