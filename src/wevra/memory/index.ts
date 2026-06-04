import type { MemoryEntry, RecallOptions, MemoryScope, Message } from '../types'

export class WevraMemory {
  private store = new Map<string, MemoryEntry[]>()

  async recall(options: RecallOptions): Promise<MemoryEntry[]> {
    const entries = this.store.get(options.scope) ?? []
    const query = options.query.toLowerCase()

    const scored = entries
      .map(entry => ({
        entry,
        score: this.relevanceScore(entry, query),
      }))
      .filter(s => s.score > 0)
      .filter(s => !options.minImportance || s.entry.importance >= options.minImportance)
      .sort((a, b) => b.score - a.score)

    return scored.slice(0, options.topK ?? 5).map(s => s.entry)
  }

  async remember(entry: MemoryEntry): Promise<void> {
    const key = entry.scope
    const entries = this.store.get(key) ?? []
    entries.push(entry)
    this.store.set(key, entries)
  }

  async extractAndRemember(_messages: Message[]): Promise<void> {
    // Phase 1: stub
  }

  getEntries(scope: MemoryScope): MemoryEntry[] {
    return this.store.get(scope) ?? []
  }

  private relevanceScore(entry: MemoryEntry, query: string): number {
    const content = entry.content.toLowerCase()
    const tags = entry.tags.map(t => t.toLowerCase())

    let score = 0
    if (content.includes(query)) score += 1
    for (const tag of tags) {
      if (query.includes(tag) || tag.includes(query)) score += 0.5
    }
    score *= entry.importance

    return score
  }
}
