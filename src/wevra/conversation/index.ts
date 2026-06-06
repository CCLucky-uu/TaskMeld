import { appendFile, mkdir, writeFile, readFile, unlink } from 'node:fs/promises'
import { existsSync, createReadStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import type { Message, ToolDefinition, ToolPreferences, ThinkingConfig } from '../types'
import type { ToolRegistry } from '../tools/registry'

// ── Types ──

export type ConversationScope = 'global' | `pipeline:${string}`

export interface ConversationMeta {
  id: string
  title: string
  scope: ConversationScope
  messageCount: number
  createdAt: number
  lastActiveAt: number
  lastAssistantAt: number
  archived: boolean
  frozenPrompt: string
  frozenTools: string[]
  mode: 'plan' | 'normal' | 'auto'
  thinkingLevel?: ThinkingConfig['level']
  toolPreferences?: ToolPreferences
  lastPromptTokens?: number
  lastCompletionTokens?: number
}

interface ConversationIndex {
  conversations: ConversationMeta[]
}

// ── Utilities ──

function generateId(scope: ConversationScope, ts: number): string {
  const prefix = scope === 'global' ? 'global' : scope.replace('pipeline:', 'pipe-')
  return hash16(`${prefix}-${ts}`)
}

function hash16(input: string): string {
  return createHash('sha256').update(input).digest('hex').slice(0, 16)
}

// ── ConversationManager ──

export class ConversationManager {
  private index: ConversationIndex | null = null
  private indexDirty = false
  private messageCache = new Map<string, Message[]>()

  constructor(
    private dataDir: string,
    private registry: ToolRegistry,
    private promptBuilder: { buildGlobalPrompt(scope?: ConversationScope): string },
  ) {}

  // ── Paths ──

  private getIndexPath() { return join(this.dataDir, 'conversations', 'index.json') }
  private getConvPath(id: string) { return join(this.dataDir, 'conversations', `${id}.jsonl`) }

  // ── Index operations ──

  private async loadIndex(): Promise<ConversationIndex> {
    if (this.index) return this.index
    const indexPath = this.getIndexPath()
    const baseDir = join(this.dataDir, 'conversations')

    if (!existsSync(indexPath)) {
      await mkdir(baseDir, { recursive: true })
      // Auto-create a default global conversation on first startup
      const now = Date.now()
      const ts = now
      const id = generateId('global', ts)
      this.index = {
        conversations: [{
          id,
          title: 'New conversation',
          scope: 'global',
          messageCount: 0,
          createdAt: now,
          lastActiveAt: now,
          lastAssistantAt: now,
          archived: false,
          frozenPrompt: this.promptBuilder.buildGlobalPrompt('global'),
          frozenTools: this.registry.toToolDefinitions().map(t => t.name),
          mode: 'normal',
        }],
      }
      await writeFile(this.getConvPath(id), '')
      await this.flushIndex()
    } else {
      const raw = await readFile(indexPath, 'utf-8')
      this.index = JSON.parse(raw) as ConversationIndex
    }
    return this.index
  }

  private async flushIndex(): Promise<void> {
    if (!this.indexDirty || !this.index) return
    const indexPath = this.getIndexPath()
    await mkdir(dirname(indexPath), { recursive: true })
    await writeFile(indexPath, JSON.stringify(this.index, null, 2))
    this.indexDirty = false
  }

  private saveIndex() { this.indexDirty = true }

  // ── Startup recovery ──

  async loadAll(): Promise<ConversationMeta[]> {
    const index = await this.loadIndex()
    this.checkArchived()
    await this.flushIndex()
    // Crash recovery: check all conversation files for integrity, and populate message cache
    for (const c of index.conversations) {
      await this.repairConvJsonl(c)
      const path = this.getConvPath(c.id)
      if (!this.messageCache.has(c.id)) {
        this.messageCache.set(c.id, await this.readConvJsonl(path))
      }
    }
    return index.conversations
  }

  /** 24h expiry check */
  private checkArchived(): void {
    if (!this.index) return
    const now = Date.now()
    let changed = false
    for (const c of this.index.conversations) {
      if (!c.archived && (now - c.lastAssistantAt) > 24 * 60 * 60 * 1000) {
        c.archived = true
        changed = true
      }
    }
    if (changed) this.saveIndex()
  }

  /** Crash recovery: check JSONL tail integrity */
  private async repairConvJsonl(meta: ConversationMeta): Promise<void> {
    const path = this.getConvPath(meta.id)
    if (!existsSync(path)) return
    const messages = await this.readConvJsonl(path)
    if (messages.length === 0) return

    const toolCallIds = new Set<string>()
    for (const msg of messages) {
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const tc of msg.toolCalls) toolCallIds.add(tc.id)
      }
      if (msg.role === 'tool' && msg.toolCallId) toolCallIds.delete(msg.toolCallId)
    }

    if (toolCallIds.size > 0) {
      // Find the last assistant message with toolCalls from the end, truncate to before it
      let truncIdx = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
          truncIdx = i - 1
          break
        }
      }
      // fallback: if no assistant-with-toolcalls found, fall back to before the last user message
      if (truncIdx < 0) {
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].role === 'user') { truncIdx = i - 1; break }
        }
      }
      if (truncIdx >= 0) {
        const truncated = messages.slice(0, truncIdx + 1)
        const lines = truncated.map(m => JSON.stringify(m))
        await writeFile(path, lines.join('\n') + (lines.length > 0 ? '\n' : ''))
        meta.messageCount = truncated.length
        meta.lastActiveAt = Date.now()
        this.saveIndex()
        this.messageCache.set(meta.id, truncated)
        console.warn(`[wevra] Repaired ${meta.id}: truncated ${messages.length - truncated.length} unclosed messages`)
      }
    }
  }

  // ── Message read/write ──

  async appendMessage(convId: string, message: Message): Promise<void> {
    const line = JSON.stringify(message)
    await appendFile(this.getConvPath(convId), line + '\n')

    const index = await this.loadIndex()
    const conv = index.conversations.find(c => c.id === convId)
    if (conv) {
      conv.messageCount++
      conv.lastActiveAt = Date.now()
      if (message.role === 'assistant') {
        conv.lastAssistantAt = Date.now()
      }
      // Sending a message auto-unarchives
      if (conv.archived) {
        conv.archived = false
      }
      this.saveIndex()
      await this.flushIndex()
    }
    // Sync update to message cache
    const cached = this.messageCache.get(convId)
    if (cached) cached.push(message)
  }

  async getFullMessages(convId: string): Promise<Message[]> {
    const cached = this.messageCache.get(convId)
    if (cached) return [...cached]
    const messages = await this.readConvJsonl(this.getConvPath(convId))
    this.messageCache.set(convId, messages)
    return messages
  }

  private async readConvJsonl(path: string): Promise<Message[]> {
    const messages: Message[] = []
    if (!existsSync(path)) return messages
    const stream = createReadStream(path, { encoding: 'utf-8' })
    const rl = createInterface({ input: stream, crlfDelay: Infinity })
    for await (const line of rl) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try { messages.push(JSON.parse(trimmed) as Message) } catch { /* skip corrupted */ }
    }
    return messages
  }

  // ── Conversation operations ──

  async createConversation(scope: ConversationScope = 'global'): Promise<ConversationMeta> {
    const index = await this.loadIndex()
    const ts = Date.now()
    const conv: ConversationMeta = {
      id: generateId(scope, ts),
      title: 'New conversation',
      scope,
      messageCount: 0,
      createdAt: ts,
      lastActiveAt: ts,
      lastAssistantAt: ts,
      archived: false,
      frozenPrompt: this.promptBuilder.buildGlobalPrompt(scope),
      frozenTools: this.registry.toToolDefinitions().map(t => t.name),
      mode: 'normal',
    }
    index.conversations.push(conv)
    await writeFile(this.getConvPath(conv.id), '')
    this.messageCache.set(conv.id, [])
    this.saveIndex()
    await this.flushIndex()
    return conv
  }

  async renameConversation(id: string, title: string): Promise<void> {
    const index = await this.loadIndex()
    const conv = index.conversations.find(c => c.id === id)
    if (conv) { conv.title = title; this.saveIndex(); await this.flushIndex() }
  }

  listConversations(): ConversationMeta[] {
    if (!this.index) throw new Error('Not loaded')
    this.checkArchived()
    return this.index.conversations
  }

  async viewConversation(id: string): Promise<Message[]> {
    return this.getFullMessages(id)
  }

  getConversation(id: string): ConversationMeta | undefined {
    if (!this.index) return undefined
    return this.index.conversations.find(c => c.id === id)
  }

  async setToolPreference(
    id: string,
    key: 'mode' | 'alwaysAllow' | 'alwaysDeny',
    value: string,
    action?: 'add' | 'remove',
  ): Promise<void> {
    const index = await this.loadIndex()
    const conv = index.conversations.find(c => c.id === id)
    if (!conv) return
    if (!conv.toolPreferences) {
      conv.toolPreferences = { mode: 'normal', alwaysAllow: [], alwaysDeny: [] }
    }
    if (key === 'mode') {
      conv.toolPreferences.mode = value as ToolPreferences['mode']
      conv.mode = value as 'plan' | 'normal' | 'auto'
    } else {
      const list = conv.toolPreferences[key]
      if (action === 'add' && !list.includes(value)) {
        list.push(value)
      } else if (action === 'remove') {
        const idx = list.indexOf(value)
        if (idx >= 0) list.splice(idx, 1)
      }
    }
    this.saveIndex()
    await this.flushIndex()
  }

  async setThinkingLevel(id: string, level: ThinkingConfig['level']): Promise<void> {
    const index = await this.loadIndex()
    const conv = index.conversations.find(c => c.id === id)
    if (!conv) return
    conv.thinkingLevel = level
    this.saveIndex()
    await this.flushIndex()
  }

  async updateTokenUsage(convId: string, promptTokens: number, completionTokens: number): Promise<void> {
    if (!this.index) return
    const conv = this.index.conversations.find(c => c.id === convId)
    if (!conv) return
    conv.lastPromptTokens = promptTokens
    conv.lastCompletionTokens = completionTokens
    this.saveIndex()
    await this.flushIndex()
  }

  async archiveConversation(convId: string): Promise<void> {
    if (!this.index) return
    const conv = this.index.conversations.find(c => c.id === convId)
    if (!conv || conv.archived) return
    conv.archived = true
    this.saveIndex()
    await this.flushIndex()
  }

  async deleteConversation(convId: string): Promise<void> {
    if (!this.index) return
    const idx = this.index.conversations.findIndex(c => c.id === convId)
    if (idx === -1) return
    this.index.conversations.splice(idx, 1)
    this.messageCache.delete(convId)
    this.saveIndex()
    await this.flushIndex()
    // Delete the JSONL file
    const path = this.getConvPath(convId)
    if (existsSync(path)) {
      await unlink(path).catch(() => {})
    }
  }
}

// ── Session data ──

export interface SessionData {
  id: string
  conversationId: string
  frozenPrompt: string
  frozenTools: ToolDefinition[]
}
