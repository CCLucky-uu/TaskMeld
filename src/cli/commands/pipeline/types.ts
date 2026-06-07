export type PipelineRunSelector = {
  pipelineId?: string
  runId?: string
  batchRunId?: string
}

export type PipelineStatusPayload = {
  ok?: boolean
  error?: string
  running?: boolean
  status?: {
    running?: boolean
    runStatus?: string
    batchRun?: { status?: string }
  }
}

export type PipelineStopPayload = {
  ok?: boolean
  error?: string
  status?: unknown
}
