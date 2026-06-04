export type WevraStreamPhase = "start" | "delta" | "end";

export type WevraStreamPayload = {
  sessionId: string;
  stream: "thinking" | "assistant" | "tool" | "meta";
  phase: WevraStreamPhase;
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult?: { output: string; isError: boolean; toolCallId?: string; metadata?: Record<string, unknown> };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
  error?: string;
};

export type WevraChatMessage = {
  id: string;
  role: "user" | "assistant" | "tool" | "thinking";
  content: string;
  timestamp: number;
  toolName?: string;
  toolArgs?: string;
  toolCallId?: string;
  isError?: boolean;
  isStreaming?: boolean;
};
