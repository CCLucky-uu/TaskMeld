import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { CliCommandHandler, CliRouteDefinition } from "../types";

const userConfigDir = join(homedir(), ".taskmeld");
const userConfigPath = join(userConfigDir, "config.json");

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  white: "\x1b[37m",
  black: "\x1b[30m",
  bgCyan: "\x1b[46m",
  bgGreen: "\x1b[42m",
};

const hr = () => {
  process.stdout.write(`\n  ${c.dim}${"─".repeat(50)}${c.reset}\n\n`);
};

const fieldPrompt = (rl: ReturnType<typeof createInterface>, label: string, hint: string, prefill?: string): Promise<string> => {
  return new Promise((resolve) => {
    process.stdout.write(`  ${c.bold}${c.white}${label}${c.reset}\n`);
    process.stdout.write(`  ${c.dim}${hint}${c.reset}\n\n`);
    rl.question(`  ${c.green}${c.bold}>${c.reset} `, (answer) => {
      resolve(answer.trim());
    });
    if (prefill) {
      rl.write(prefill);
    }
  });
};

type UserGatewayConfig = {
  gatewayUrl?: string;
  gatewayToken?: string;
};

const readConfig = async (): Promise<UserGatewayConfig> => {
  try {
    const raw = await readFile(userConfigPath, "utf8");
    return JSON.parse(raw) as UserGatewayConfig;
  } catch {
    return {};
  }
};

const writeConfig = async (config: UserGatewayConfig): Promise<void> => {
  await mkdir(userConfigDir, { recursive: true });
  const existing = await readConfig();
  const merged = { ...existing, ...config };
  await writeFile(userConfigPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
};

export const initCommand: CliCommandHandler = async (input) => {
  let url = typeof input.flags.url === "string" ? input.flags.url.trim() : "";
  let token = typeof input.flags.token === "string" ? input.flags.token.trim() : "";

  const interactive = !url || !token;

  if (interactive) {
    console.log("");
    console.log(`  ${c.bold}${c.cyan}TaskMeld${c.reset}  ${c.dim}·  First-time Setup${c.reset}`);
    console.log("");
    console.log(`  ${c.dim}Configure your OpenClaw Gateway connection to get started.${c.reset}`);
    console.log(`  ${c.dim}Config  ${userConfigPath}${c.reset}`);

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (!url) {
      hr();
      url = await fieldPrompt(rl, "Gateway URL", "ws:// or wss:// address of your OpenClaw Gateway", "ws://127.0.0.1:18789") || "ws://127.0.0.1:18789";
    }

    if (url && !token) {
      hr();
      token = await fieldPrompt(rl, "Gateway Token", "Authentication token for the Gateway");
    }

    rl.close();

    if (!url || !token) {
      throw new Error("Both Gateway URL and Token are required to complete setup.");
    }
  }

  if (!url.startsWith("ws://") && !url.startsWith("wss://")) {
    throw new Error(`Invalid Gateway URL: ${url}. Must start with ws:// or wss://`);
  }

  await writeConfig({
    gatewayUrl: url,
    gatewayToken: token,
  });

  if (interactive) {
    console.log("");
    console.log(`  ${c.bgGreen}${c.black}${c.bold} > Gateway configured successfully ${c.reset}`);
    console.log("");
    console.log(`  ${c.dim}URL${c.reset}     ${url}`);
    console.log(`  ${c.dim}Config${c.reset}  ${userConfigPath}`);
    console.log("");
    console.log(`  ${c.dim}Run ${c.white}\"taskmeld server start\"${c.reset}${c.dim} to begin.${c.reset}`);
    console.log("");
  }

  return {
    ok: true,
    gatewayUrl: url,
    configPath: userConfigPath,
    interactive,
  };
};

export const initRoutes: CliRouteDefinition[] = [
  {
    key: "init",
    path: ["init"],
    description: "Guided setup for OpenClaw Gateway connection",
    handler: initCommand,
    renderHelp: () => {
      const lines = [
        "Usage:",
        "  taskmeld init [--url <url>] [--token <token>]",
        "",
        "Description:",
        "  Guided first-time setup — configure the OpenClaw Gateway connection.",
        `  Config is saved to ${userConfigPath}`,
        "",
        "Options:",
        "  --url <url>      Gateway WebSocket URL (ws:// or wss://)",
        "  --token <token>  Gateway authentication token",
        "",
        "Examples:",
        "  taskmeld init",
        "  taskmeld init --url ws://127.0.0.1:18789 --token your-token",
        "",
        "Notes:",
        "  Running without flags starts an interactive guided setup.",
        "  Environment variables (OPENCLAW_GATEWAY_URL/TOKEN) take precedence over this config.",
      ];
      return lines.join("\n");
    },
    help: {
      usage: "taskmeld init [--url <url>] [--token <token>]",
      summary: "Guided first-time setup — configure the OpenClaw Gateway connection.",
      options: [
        { flags: ["--url"], valueName: "url", description: "Gateway WebSocket URL (ws:// or wss://)" },
        { flags: ["--token"], valueName: "token", description: "Gateway authentication token" },
      ],
      examples: [
        "taskmeld init",
        "taskmeld init --url ws://127.0.0.1:18789 --token your-token",
      ],
      notes: [
        "Running without flags starts an interactive guided setup.",
        "Config is saved to ~/.taskmeld/config.json.",
        "Environment variables (OPENCLAW_GATEWAY_URL/TOKEN) take precedence over this config.",
      ],
    },
  },
];
