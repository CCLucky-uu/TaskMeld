import type { CliError } from "./errors"
import type { CliGlobalOptions } from "./types"
import { renderErrorByMode, renderSuccessByMode } from "./renderers"

// Success output is dispatched uniformly by the renderer; command layer does not assemble text directly.
export const writeResult = (
  stream: NodeJS.WritableStream,
  command: string,
  data: unknown,
  global: CliGlobalOptions,
): void => {
  stream.write(`${renderSuccessByMode(command, data, global)}\n`)
}

// Errors are consistently written to stderr to avoid polluting the stdout result stream.
export const writeError = (
  stream: NodeJS.WritableStream,
  error: CliError,
  command: string | undefined,
  global: { format: string },
): void => {
  stream.write(`${renderErrorByMode(command, error, global)}\n`)
}

// Help info is output as plain text to stdout for easy human reading.
export const writeHelp = (stream: NodeJS.WritableStream, helpText: string): void => {
  stream.write(`${helpText}\n`)
}
