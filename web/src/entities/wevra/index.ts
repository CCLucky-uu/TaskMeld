export type WevraStreamPhase = "start" | "delta" | "end" | "confirm_request" | "question_request" | "busy" | "idle";

export type WevraStreamPayload = {
  sessionId: string;
  stream: "thinking" | "assistant" | "tool" | "meta" | "confirm" | "question" | "status";
  phase: WevraStreamPhase;
  content?: string;
  toolCall?: { id: string; name: string; arguments: Record<string, unknown> };
  toolResult?: { output: string; isError: boolean; toolCallId?: string; metadata?: Record<string, unknown>; attachments?: Array<{ type: string; data: string }> };
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number; reasoningTokens?: number };
  error?: string;
  question?: WevraQuestionPayload;
};

export type WevraQuestionOption = {
  label: string;
  description: string;
};

export type WevraQuestionItem = {
  question: string;
  header?: string;
  options: WevraQuestionOption[];
  multiSelect: boolean;
};

export type WevraQuestionPayload = {
  toolCallId: string;
  questions: WevraQuestionItem[];
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

export type WevraModelInfo = {
  providerId: string;
  modelId: string;
  label?: string;
  contextWindow?: number;
  readonly?: boolean;
  enabled?: boolean;
};

export type WevraModelProvider = {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  modelCount: number;
  readonly: boolean;
};

export type WevraConfigResponse = {
  models: WevraModelInfo[];
  default: string;
  thinkingLevels: string[];
  providers: WevraModelProvider[];
};
