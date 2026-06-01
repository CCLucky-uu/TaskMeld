import { CliError, assertRequiredArg } from "../errors";
import { t } from "../i18n";
import type { CliCommandHandler, CliRouteDefinition } from "../types";

const readFlagAsPositiveInteger = (value: string | boolean | undefined, fallback: number): number => {
  if (typeof value !== "string") return fallback;
  const parsed = Number.parseInt(value.trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const agentListCommand: CliCommandHandler = async (_input, ctx) => {
  return ctx.app.agentService.listAgents();
};

const parseSessionId = (id: string): { agentId: string | null; sessionId: string } => {
  const parts = id.split(":");
  if (parts.length >= 3 && parts[0] === "agent") {
    return { agentId: parts[1], sessionId: parts.slice(2).join(":") };
  }
  return { agentId: null, sessionId: id };
};

export const agentSessionCommand: CliCommandHandler = async (input, ctx) => {
  const agentId = input.args[0];
  const sessions = agentId
    ? await ctx.app.agentService.filterSessionsByAgent(agentId)
    : await ctx.app.agentService.listSessions();
  const items = Array.isArray(sessions) ? sessions : [];
  return items.map((s: Record<string, unknown>) => {
    const rawId = typeof s.id === "string" ? s.id : "";
    const parsed = parseSessionId(rawId);
    return {
      agentId: parsed.agentId,
      sessionId: parsed.sessionId,
      raw: s,
    };
  });
};

const readPipedStdin = async (stdin?: NodeJS.ReadableStream): Promise<string> => {
  if (!stdin || (stdin as NodeJS.ReadableStream & { isTTY?: boolean }).isTTY) return "";
  return new Promise<string>((resolve, reject) => {
    let content = "";
    stdin.setEncoding?.("utf8");
    stdin.on("data", (chunk: string | Buffer) => {
      content += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    });
    stdin.on("end", () => resolve(content.trim()));
    stdin.on("error", reject);
  });
};

export const agentSendCommand: CliCommandHandler = async (input, ctx) => {
  const agentId = assertRequiredArg(input.args[0], "agentId");
  const messageFromArgs = (input.args[1] ?? "").trim().replace(/\\n/g, "\n");
  const messageFromStdin = !messageFromArgs ? await readPipedStdin(input.stdin) : "";
  const message = messageFromArgs || messageFromStdin;
  if (!message) {
    throw new CliError("Missing message: provide a positional argument or pipe via stdin", {
      code: "INVALID_ARGUMENT",
      exitCode: 2,
    });
  }
  const sessionId = typeof input.flags.session === "string" && input.flags.session.trim()
    ? input.flags.session.trim()
    : "main";
  const fullSessionId = `agent:${sessionId}:${agentId}`;

  const timeoutMs = readFlagAsPositiveInteger(input.flags.timeout, 120_000);
  const streamVal = input.flags.stream;
  const isStreaming = streamVal === true || (typeof streamVal === "string" && streamVal === "true");

  if (isStreaming && ctx.global.format !== "json") {
    const result = await ctx.app.agentService.sendMessageAndWaitForReply(
      { sessionId: fullSessionId, message },
      {
        timeoutMs,
        onChunk: (text: string) => {
          process.stdout.write(text);
        },
      },
    );
    process.stdout.write("\n");
    return { ...(result as Record<string, unknown>), streamed: true };
  }

  return ctx.app.agentService.sendMessageAndWaitForReply(
    { sessionId: fullSessionId, message },
    { timeoutMs },
  );
};

export const agentRoutes: CliRouteDefinition[] = [
  {
    key: "agent.list",
    path: ["agent", "list"],
    description: t("agent.list.description"),
    handler: agentListCommand,
    bootstrap: { gateway: "required" },
    help: {
      usage: "taskmeld agent list [--format <json|md>]",
      summary: t("agent.list.summary"),
    },
  },
  {
    key: "agent.session",
    path: ["agent", "session"],
    description: t("agent.session.description"),
    handler: agentSessionCommand,
    bootstrap: { gateway: "required" },
    help: {
      usage: "taskmeld agent session [agentId] [--format <json|md>]",
      summary: t("agent.session.summary"),
      args: [{ name: "agentId", required: false, description: t("agent.session.argAgentId") }],
    },
  },
  {
    key: "agent.send",
    path: ["agent", "send"],
    description: t("agent.send.description"),
    handler: agentSendCommand,
    bootstrap: { gateway: "required" },
    help: {
      usage: "taskmeld agent send <agentId> <message> [--session <id>] [--format <json|md>]",
      summary: t("agent.send.summary"),
      args: [
        { name: "agentId", required: true, description: t("agent.send.argAgentId") },
        { name: "message", required: true, description: t("agent.send.argMessage") },
      ],
      options: [
        { flags: ["--session"], valueName: "id", description: t("agent.send.optSession") },
        { flags: ["--stream"], description: t("agent.send.optStream") },
      ],
    },
  },
];
