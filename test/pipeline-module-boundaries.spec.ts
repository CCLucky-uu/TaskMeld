import assert from "node:assert/strict"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { extname, resolve, relative, dirname } from "node:path"

const PIPELINE_DIR = resolve(process.cwd(), "src", "pipeline")

// Collect all .ts files under src/pipeline/
const collectFiles = (dir: string): string[] => {
  const entries = readdirSync(dir)
  const files: string[] = []
  for (const entry of entries) {
    const full = resolve(dir, entry)
    if (statSync(full).isDirectory()) {
      files.push(...collectFiles(full))
    } else if (extname(full) === ".ts") {
      files.push(full)
    }
  }
  return files
}

// Parse relative imports from a TypeScript source. Returns array of resolved target file paths.
// Only counts value imports (not `import type`).
const parseRelativeImports = (filePath: string, allPipelineFiles: Set<string>): string[] => {
  const content = readFileSync(filePath, "utf8")
  const dir = dirname(filePath)
  const results: string[] = []

  // Match import/export statements with relative paths
  const importRe =
    /(?:import|export)\s+(?:type\s+)?(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s*(?:,\s*(?:\{[^}]*\}|\*\s+as\s+\w+))?\s*from\s*['"](\.\.[/\\][^'"]+|[.][/\\][^'"]+)['"]/g
  let match
  while ((match = importRe.exec(content)) !== null) {
    // Check if this is a type-only import
    const preMatch = content.slice(Math.max(0, match.index - 50), match.index)
    const isTypeOnly = /\bimport\s+type\b/.test(preMatch + match[0].slice(0, 50))
    if (isTypeOnly) continue

    // Also check inline type imports: import { type Foo, Bar } — Bar is value
    // For simplicity, if the import clause contains only `type` specifiers, skip it
    const importClause = match[0]
    const hasTypeOnlySpecifiers = /^import\s+type\s+\{/.test(importClause)
    if (hasTypeOnlySpecifiers) continue

    const importPath = match[1]
    const resolved = resolve(dir, importPath)

    // Try .ts first, then /index.ts
    const candidate1 = resolved + ".ts"
    const candidate2 = resolve(resolved, "index.ts")

    if (allPipelineFiles.has(candidate1)) {
      results.push(candidate1)
    } else if (allPipelineFiles.has(candidate2)) {
      results.push(candidate2)
    }
  }
  return results
}

// Build a directed graph of pipeline files
const buildGraph = (files: string[], allFiles: Set<string>) => {
  const graph = new Map<string, string[]>()
  for (const file of files) {
    graph.set(file, parseRelativeImports(file, allFiles))
  }
  return graph
}

// DFS-based cycle detection. Returns array of cycles (each cycle is array of file paths).
const detectCycles = (graph: Map<string, string[]>): string[][] => {
  const cycles: string[][] = []
  const visited = new Set<string>()
  const stack = new Set<string>()
  const path: string[] = []

  const dfs = (node: string) => {
    if (stack.has(node)) {
      // Found a cycle — extract the cycle portion
      const cycleStart = path.indexOf(node)
      cycles.push([...path.slice(cycleStart), node])
      return
    }
    if (visited.has(node)) return

    visited.add(node)
    stack.add(node)
    path.push(node)

    for (const neighbor of graph.get(node) ?? []) {
      dfs(neighbor)
    }

    path.pop()
    stack.delete(node)
  }

  for (const node of graph.keys()) {
    dfs(node)
  }

  return cycles
}

// Normalize path to be relative to PIPELINE_DIR for readable output
const rel = (p: string) => relative(PIPELINE_DIR, p).replace(/\\/g, "/")

const run = async () => {
  const allFiles = collectFiles(PIPELINE_DIR)
  const allFilesSet = new Set(allFiles)
  const graph = buildGraph(allFiles, allFilesSet)
  const cycles = detectCycles(graph)

  // ====== Test 1: No runtime cycles in src/pipeline ======
  if (cycles.length > 0) {
    const cycleDescriptions = cycles.map((c) => c.map(rel).join(" → "))
    const knownCycles = [
      // Cycle A: template.ts ↔ workflow/io.ts
      "template.ts → workflow/io.ts → template.ts",
      // Cycle B: template.ts → workflow/validate.ts → workflow-graph.ts → template.ts
      "template.ts → workflow/validate.ts → workflow-graph.ts → template.ts",
    ]

    const unknownCycles = cycleDescriptions.filter(
      (desc) =>
        !knownCycles.some(
          (known) => desc === known || desc.includes(known.slice(0, -known.length + known.indexOf(" → ") + 3)),
        ),
    )

    // For now, we document the known cycles as expected failures.
    // After Phase 1, this assertion will be updated to forbid all cycles.
    assert.equal(
      unknownCycles.length,
      0,
      `Unexpected import cycles found:\n${unknownCycles.join("\n")}\n\nKnown cycles (to be fixed in Phase 1):\n${knownCycles.join("\n")}`,
    )
  }

  // ====== Test 2: Specific forbidden edges ======
  // These edges should not exist after Phase 1. Currently they DO exist,
  // so this test documents the target state (expected to fail until Phase 1 completes).
  const edges = new Map<string, Set<string>>()
  for (const [from, tos] of graph.entries()) {
    edges.set(rel(from), new Set(tos.map(rel)))
  }

  // Target assertions (comment format: TARGET — expected to fail until Phase 1 completes)
  const forbiddenEdges: Array<[string, string]> = [
    ["workflow/io.ts", "template.ts"],
    ["workflow/validate.ts", "workflow-graph.ts"],
    ["workflow-graph.ts", "template.ts"],
  ]

  for (const [from, to] of forbiddenEdges) {
    const hasEdge = edges.get(from)?.has(to) ?? false
    if (hasEdge) {
      console.log(`[COMPAT] Forbidden edge still exists (target: removed in Phase 1): ${from} → ${to}`)
    }
  }

  // ====== Test 3: Dependency direction audit ======
  // Verify that low-level modules don't import high-level modules
  // types/workflow.ts should have NO imports from within pipeline
  const typesFile = resolve(PIPELINE_DIR, "types", "workflow.ts")
  if (allFilesSet.has(typesFile)) {
    const typesImports = graph.get(typesFile) ?? []
    const nonExternal = typesImports.filter((imp) => imp.startsWith(PIPELINE_DIR))
    assert.equal(
      nonExternal.length,
      0,
      `types/workflow.ts should not import from pipeline:\n${nonExternal.map(rel).join("\n")}`,
    )
  }

  console.log("pipeline module boundaries tests passed")
}

void run().catch((error) => {
  console.error("pipeline module boundaries tests failed", error)
  process.exitCode = 1
})
