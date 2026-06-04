import type { Message, ToolDefinition, SessionConfig, SessionType } from '../types'

// TODO: Phase 2 - integrate with agent loop for session lifecycle management

export interface Session {
  id: string
  type: SessionType
  pipelineId?: string
  messages: Message[]
  frozenPrompt: string
  frozenTools: ToolDefinition[]
  createdAt: number
  lastActiveAt: number
}

export class SessionManager {
  private sessions = new Map<string, Session>()
  private counter = 0

  create(config: SessionConfig, frozenPrompt: string, frozenTools: ToolDefinition[]): Session {
    const id = `sess-${Date.now().toString(36)}-${++this.counter}`
    const now = Date.now()

    const session: Session = {
      id,
      type: config.type,
      pipelineId: config.pipelineId,
      messages: [],
      frozenPrompt,
      frozenTools,
      createdAt: now,
      lastActiveAt: now,
    }

    this.sessions.set(id, session)
    return session
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId)
  }

  appendMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session "${sessionId}" not found`)
    session.messages.push(message)
    session.lastActiveAt = Date.now()
  }

  appendMessages(sessionId: string, messages: Message[]): void {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error(`Session "${sessionId}" not found`)
    session.messages.push(...messages)
    session.lastActiveAt = Date.now()
  }

  archive(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  listActive(): Session[] {
    return Array.from(this.sessions.values())
  }

  findByType(type: SessionType, pipelineId?: string): Session | undefined {
    return Array.from(this.sessions.values()).find(s =>
      s.type === type && (!pipelineId || s.pipelineId === pipelineId),
    )
  }
}
