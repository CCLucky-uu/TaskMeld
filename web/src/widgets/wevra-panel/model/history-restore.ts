import type { WevraChatMessage } from "../../../entities/wevra";

export interface RawMessage {
  role: string;
  content: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  reasoningContent?: string;
  isError?: boolean;
}

export interface ConvMeta {
  id: string;
  title: string;
  scope?: string;
  archived: boolean;
  messageCount?: number;
  createdAt?: number;
  lastActiveAt?: number;
}

/** 从后端 JSONL 消息还原为前端 WevraChatMessage 列表 */
export function restoreMessages(msgs: RawMessage[]): WevraChatMessage[] {
  const mapped: WevraChatMessage[] = [];
  // 收集所有 assistant 的 toolCalls，建立 toolCallId → { name, args } 索引
  const toolCallIndex = buildToolCallIndex(msgs);

  for (let i = 0; i < msgs.length; i++) {
    const m = msgs[i];
    const id = `hist-${i}`;

    switch (m.role) {
      case 'assistant': {
        const toolName = m.toolCalls?.[0]?.name;
        if (m.reasoningContent) {
          mapped.push(toChatMsg(`${id}-thinking`, 'thinking', m.reasoningContent));
        }
        mapped.push(toolName
          ? { ...toChatMsg(`${id}-assistant`, 'assistant', m.content), toolName }
          : toChatMsg(`${id}-assistant`, 'assistant', m.content));
        break;
      }
      case 'tool': {
        const info = m.toolCallId ? toolCallIndex.get(m.toolCallId) : undefined;
        mapped.push({
          ...toChatMsg(`${id}-tool`, 'tool', m.content, m.isError),
          toolName: info?.name ?? lastAssistantToolName(mapped),
          toolArgs: info?.args,
        });
        break;
      }
      default:
        mapped.push(toChatMsg(id, m.role as WevraChatMessage['role'], m.content, m.isError));
    }
  }

  return mapped;
}

function toChatMsg(id: string, role: WevraChatMessage['role'], content: string, isError?: boolean): WevraChatMessage {
  return { id, role, content: content ?? '', timestamp: Date.now(), isStreaming: false, ...(isError ? { isError } : {}) };
}

function lastAssistantToolName(mapped: WevraChatMessage[]): string | undefined {
  for (let i = mapped.length - 1; i >= 0; i--) {
    if (mapped[i].role === 'assistant') return mapped[i].toolName;
  }
  return undefined;
}

function buildToolCallIndex(msgs: RawMessage[]): Map<string, { name: string; args: string }> {
  const index = new Map<string, { name: string; args: string }>();
  for (const m of msgs) {
    if (m.role === 'assistant' && m.toolCalls) {
      for (const tc of m.toolCalls) {
        index.set(tc.id, { name: tc.name, args: JSON.stringify(tc.arguments, null, 2) });
      }
    }
  }
  return index;
}
