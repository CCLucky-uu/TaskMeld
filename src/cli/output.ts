import type { CliError } from "./errors";
import type { CliGlobalOptions } from "./types";
import { renderErrorByMode, renderSuccessByMode } from "./renderers";

// 成功输出由 renderer 统一分发，命令层不直接拼接文本。
export const writeResult = (
  stream: NodeJS.WritableStream,
  command: string,
  data: unknown,
  global: CliGlobalOptions,
): void => {
  stream.write(`${renderSuccessByMode(command, data, global)}\n`);
};

// 错误统一写 stderr，避免污染 stdout 结果流。
export const writeError = (stream: NodeJS.WritableStream, error: CliError, command: string | undefined, global: { format: string }): void => {
  stream.write(`${renderErrorByMode(command, error, global)}\n`);
};

// 帮助信息输出纯文本到 stdout，便于人类直接阅读。
export const writeHelp = (stream: NodeJS.WritableStream, helpText: string): void => {
  stream.write(`${helpText}\n`);
};
