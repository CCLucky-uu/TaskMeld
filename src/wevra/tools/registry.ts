import type { Tool, ToolDefinition } from '../types'

export class ToolRegistry {
  private tools = new Map<string, Tool>()

  register(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  toToolDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
      annotations: t.annotations,
      permission: t.permission,
    }))
  }

  byCategories(categories: string[]): ToolDefinition[] {
    const prefix = categories.map(c => c + '.')
    return this.toToolDefinitions().filter(t =>
      prefix.some(p => t.name.startsWith(p)),
    )
  }

  get size(): number {
    return this.tools.size
  }
}
