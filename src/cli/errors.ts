export class CliError extends Error {
  public readonly code: string;
  public readonly exitCode: number;
  public readonly details?: unknown;

  public constructor(message: string, options?: { code?: string; exitCode?: number; details?: unknown }) {
    super(message);
    this.name = "CliError";
    this.code = options?.code ?? "CLI_ERROR";
    this.exitCode = options?.exitCode ?? 1;
    this.details = options?.details;
  }
}

// Unify unknown exception normalization to prevent CLI output structure drift.
export const toCliError = (error: unknown): CliError => {
  if (error instanceof CliError) return error;
  if (error instanceof Error) {
    return new CliError(error.message, {
      code: "UNEXPECTED_ERROR",
      exitCode: 1,
    });
  }
  return new CliError("Unknown CLI error", {
    code: "UNEXPECTED_ERROR",
    exitCode: 1,
    details: error,
  });
};

// Without altering the original error metadata, attach a help hint to argument-type errors.
export const withHelpHint = (error: CliError, hint: string): CliError => {
  if (!hint.trim()) return error;
  if (error.message.includes(hint)) return error;
  return new CliError(`${error.message}. ${hint}`, {
    code: error.code,
    exitCode: error.exitCode,
    details: error.details,
  });
};

export const assertRequiredArg = (value: string | undefined, name: string): string => {
  if (value && value.trim()) return value.trim();
  throw new CliError(`Missing required argument: ${name}`, {
    code: "INVALID_ARGUMENT",
    exitCode: 2,
  });
};

export const assertBooleanFlag = (value: string | boolean | undefined, name: string): boolean => {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  throw new CliError(`Invalid boolean flag: --${name}`, {
    code: "INVALID_ARGUMENT",
    exitCode: 2,
  });
};
