/** Wevra Agent shared type definitions */

// ── Tool ──

export interface ToolAnnotations {
  readOnly: boolean
  destructive: boolean
  requiresConfirmation: boolean
  idempotent: boolean
}

export type PermissionLevel = "auto" | "confirm" | "elevated"

export type ExecutionMode = "plan" | "normal" | "auto"

export interface ToolPreferences {
  mode: ExecutionMode
  alwaysAllow: string[]
  alwaysDeny: string[]
}

export const DEFAULT_TOOL_PREFERENCES: ToolPreferences = {
  mode: "normal",
  alwaysAllow: [],
  alwaysDeny: [],
}

export interface ConfirmRequest {
  toolCallId: string
  toolName: string
  toolArgs: Record<string, unknown>
}

export interface QuestionOption {
  label: string
  description: string
}

export interface QuestionItem {
  question: string
  header?: string
  options: QuestionOption[]
  multiSelect: boolean
}

export interface QuestionRequest {
  toolCallId: string
  questions: QuestionItem[]
}

export type QuestionAnswer = {
  answers: Array<{ question: string; selected: Array<{ label: string; description: string; isCustom?: boolean }> }>
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: JsonSchema
  annotations: ToolAnnotations
  permission: PermissionLevel
}

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface ToolResult {
  output: string
  isError: boolean
  needsConfirmation?: boolean
  needsUserInput?: boolean
  toolCallId?: string
  metadata?: Record<string, unknown>
  attachments?: Attachment[]
}

export interface Attachment {
  type: "image" | "file" | "blueprint"
  mimeType: string
  data: string
  name?: string
}

export type ValidationResult = { valid: true; parsed: unknown } | { valid: false; error: string }

export interface Tool extends ToolDefinition {
  validate?(args: unknown): ValidationResult
  execute(args: unknown, ctx: ToolContext): Promise<ToolResult>
}

// ── Tool Context ──

export interface ToolContext {
  sessionId: string
  conversationId: string
  messageId: string
  preferences: ToolPreferences
  abortSignal: AbortSignal
  requestPermission(action: string): Promise<boolean>
  services: unknown
  memory: unknown
  webFetcher: unknown
  logger: Logger
}

export interface Logger {
  info(msg: string, meta?: unknown): void
  warn(msg: string, meta?: unknown): void
  error(msg: string, meta?: unknown): void
  debug(msg: string, meta?: unknown): void
}

// ── LLM / Brain ──

export type MessageRole = "system" | "user" | "assistant" | "tool"

export interface Message {
  role: MessageRole
  content: string
  toolCalls?: ToolCall[]
  toolCallId?: string
  isError?: boolean
  /** DeepSeek: turns with tool calls must pass back reasoning_content in all subsequent requests */
  reasoningContent?: string
  /** Unix timestamp (ms) when this message was created. Used for display only, not sent to LLM. */
  timestamp?: number
}

export interface LLMResponse {
  content: string
  toolCalls: ToolCall[]
  usage: TokenUsage
  finishReason: "stop" | "tool_calls" | "length"
}

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens?: number
  reasoningTokens?: number
}

export type StreamEventType =
  | "thinking_start"
  | "thinking_delta"
  | "thinking_end"
  | "text_start"
  | "text_delta"
  | "text_end"
  | "tool_start"
  | "tool_delta"
  | "tool_end"
  | "step_finish"
  | "confirm_request"
  | "confirm_response"
  | "question_request"
  | "question_response"
  | "error"

export interface StreamEvent {
  type: StreamEventType
  content?: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  usage?: TokenUsage
  error?: string
}

export interface LLMConfig {
  baseURL: string
  apiKey: string
  model: string
  maxTokens?: number
  temperature?: number
  thinking?: ThinkingConfig
}

export interface ThinkingConfig {
  level: "off" | "low" | "medium" | "high" | "max"
  budgetTokens?: number
}

// ── Model & Provider Config ──

export interface ModelCompat {
  supportsReasoningEffort: boolean
  supportsUsageInStreaming: boolean
  maxTokensField: "max_tokens" | "max_completion_tokens"
  requiresReasoningContentPassthrough: boolean
  temperatureIgnoredInThinking: boolean
  extraBodyThinkingToggle: boolean
}

export interface ModelProfile {
  id: string
  name: string
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  compat: ModelCompat
}

export interface ProviderProfile {
  name: string
  baseUrl: string
  api: "openai-completions"
  models: ModelProfile[]
  readonly?: boolean
}

export interface RuntimeModelConfig {
  providerId: string
  modelId: string
  baseUrl: string
  apiKey: string
  api: "openai-completions"
  contextWindow: number
  maxTokens: number
  reasoning: boolean
  compat: ModelCompat
  thinking?: ThinkingConfig
  label?: string
  readonly?: boolean
}

export interface ModelsJson {
  version: number
  default?: { provider: string; model: string }
  enabledModels?: string[]
  providers: Record<
    string,
    {
      baseUrl: string
      api: string
      apiKey: string
      models: Array<ModelProfile & { enabled?: boolean }>
    }
  >
}

// ── Memory ──

export type MemoryType = "fact" | "preference" | "event" | "summary"
export type MemoryScope = "global" | "pipeline"

export interface MemoryEntry {
  content: string
  type: MemoryType
  scope: MemoryScope
  scopeRef?: string
  importance: number
  tags: string[]
  source: string
  createdAt: string
}

export interface RecallOptions {
  query: string
  scope: MemoryScope
  scopeRef?: string
  topK?: number
  minImportance?: number
}

// ── Skill ──

export type SkillInvocation = "always" | "auto" | "user" | "model"

export interface SkillDef {
  name: string
  description: string
  invocation: SkillInvocation
  content: string
}

// ── Agent Loop ──

export type LoopResultType = "text" | "confirm" | "question" | "error"

export interface LoopResult {
  type: LoopResultType
  content?: string
  iterations: number
  usage?: TokenUsage
}

// ── JSON Schema ──

export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  items?: JsonSchema
  description?: string
  enum?: unknown[]
  default?: unknown
}

export interface JsonSchemaProperty {
  type: string
  description?: string
  enum?: unknown[]
  default?: unknown
  items?: JsonSchema
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

// ── LLM Provider raw response types (for parsing) ──

export interface OpenAIChatResponse {
  id: string
  choices: Array<{
    index: number
    message: {
      role: string
      content: string | null
      tool_calls?: Array<{
        id: string
        type: "function"
        function: {
          name: string
          arguments: string
        }
      }>
      reasoning_content?: string | null
    }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
    completion_tokens_details?: {
      reasoning_tokens?: number
    }
  }
}

export interface OpenAIStreamChunk {
  id: string
  choices: Array<{
    index: number
    delta: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      tool_calls?: Array<{
        index: number
        id?: string
        type?: "function"
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
    finish_reason: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
    prompt_tokens_details?: {
      cached_tokens?: number
    }
    completion_tokens_details?: {
      reasoning_tokens?: number
    }
  }
}
