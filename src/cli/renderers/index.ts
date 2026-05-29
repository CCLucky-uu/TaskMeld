import { CliError } from "../errors";
import { commandRenderSpecs } from "./specs";
import { extractIr, formatMarkdown } from "./engine/markdown";
import { formatJson, renderJsonError } from "./engine/json";

export const renderSuccessByMode = (command: string, data: unknown, global: { format: string; envelope: boolean }): string => {
  const spec = commandRenderSpecs[command];
  if (!spec) {
    throw new CliError(`No render spec registered for command: ${command}`, {
      code: "MISSING_RENDER_SPEC",
      exitCode: 1,
      details: { command },
    });
  }
  const ir = extractIr(spec, data);
  return global.format === "md" ? formatMarkdown(ir) : formatJson(ir, global.envelope, command);
};

export const renderErrorByMode = (command: string | undefined, error: CliError, global: { format: string }): string => {
  if (global.format === "md") {
    return `# Error\n\n**${error.code}** — ${error.message}`;
  }
  return renderJsonError(command, error);
};
