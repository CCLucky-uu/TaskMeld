import { appendFile, mkdir, writeFile, readFile, rename, unlink } from 'node:fs/promises'
import { existsSync, createReadStream } from 'node:fs'
import { join, dirname } from 'node:path'
import { createHash } from 'node:crypto'
import { createInterface } from 'node:readline'
import type { Message, ToolDefinition, ToolPreferences } from '../types'
import type { ToolRegistry } from '../tools/registry'

// ── 类型 ──

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
  toolPreferences?: ToolPreferences
}

interface ConversationIndex {
  conversations: ConversationMeta[]
}

// ── 工具函数 ──

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

  // ── 路径 ──

  private getIndexPath() { return join(this.dataDir, 'conversations', 'index.json') }
  private getConvPath(id: string) { return join(this.dataDir, 'conversations', `${id}.jsonl`) }

  // ── Index 操作 ──

  private async loadIndex(): Promise<ConversationIndex> {
    if (this.index) return this.index
    const indexPath = this.getIndexPath()
    const baseDir = join(this.dataDir, 'conversations')

    if (!existsSync(indexPath)) {
      await mkdir(baseDir, { recursive: true })
      // 首次启动自动创建默认全局对话
      const now = Date.now()
      const ts = now
      const id = generateId('global', ts)
      this.index = {
        conversations: [{
          id,
          title: '新对话',
          scope: 'global',
          messageCount: 0,
          createdAt: now,
          lastActiveAt: now,
          lastAssistantAt: now,
          archived: false,
          frozenPrompt: this.promptBuilder.buildGlobalPrompt('global'),
          frozenTools: this.registry.toToolDefinitions().map(t => t.name),
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

  // ── 启动恢复 ──

  async loadAll(): Promise<ConversationMeta[]> {
    const index = await this.loadIndex()
    this.checkArchived()
    await this.flushIndex()
    // 崩溃恢复：检查所有对话文件末尾完整性，同时填充消息缓存
    for (const c of index.conversations) {
      await this.repairConvJsonl(c)
      const path = this.getConvPath(c.id)
      if (!this.messageCache.has(c.id)) {
        this.messageCache.set(c.id, await this.readConvJsonl(path))
      }
    }
    return index.conversations
  }

  /** 24h 过期检查 */
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

  /** 崩溃恢复：检查 JSONL 末尾 */
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
      // 从后往前找最后一个有 toolCalls 的 assistant 消息，截断到该消息之前
      let truncIdx = -1
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i]
        if (msg.role === 'assistant' && msg.toolCalls && msg.toolCalls.length > 0) {
          truncIdx = i - 1
          break
        }
      }
      // fallback: 找不到 assistant-with-toolcalls 时回退到最后一个 user 消息之前
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

  // ── 消息读写 ──

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
      // 发消息自动解档
      if (conv.archived) {
        conv.archived = false
      }
      this.saveIndex()
      await this.flushIndex()
    }
    // 同步更新消息缓存
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

  // ── 对话操作 ──

  async createConversation(scope: ConversationScope = 'global'): Promise<ConversationMeta> {
    const index = await this.loadIndex()
    const ts = Date.now()
    const conv: ConversationMeta = {
      id: generateId(scope, ts),
      title: '新对话',
      scope,
      messageCount: 0,
      createdAt: ts,
      lastActiveAt: ts,
      lastAssistantAt: ts,
      archived: false,
      frozenPrompt: this.promptBuilder.buildGlobalPrompt(scope),
      frozenTools: this.registry.toToolDefinitions().map(t => t.name),
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
}

// ── Session 数据 ──

export interface SessionData {
  id: string
  conversationId: string
  frozenPrompt: string
  frozenTools: ToolDefinition[]
}
