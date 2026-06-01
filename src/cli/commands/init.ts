import { createInterface } from "node:readline";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { CliCommandHandler, CliRouteDefinition } from "../types";
import { t, changeLocale } from "../i18n";
import { hr, fieldPrompt, selectPrompt } from "../ui-prompts";

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

const userConfigDir = join(homedir(), ".taskmeld");
const userConfigPath = join(userConfigDir, "config.json");

type UserGatewayConfig = {
  gatewayUrl?: string;
  gatewayToken?: string;
  locale?: string;
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
  const sanitized: UserGatewayConfig = {};
  if (typeof existing.gatewayUrl === 'string') sanitized.gatewayUrl = existing.gatewayUrl;
  if (typeof existing.gatewayToken === 'string') sanitized.gatewayToken = existing.gatewayToken;
  if (typeof existing.locale === 'string' && ['zh', 'en'].includes(existing.locale)) sanitized.locale = existing.locale;
  const merged = { ...sanitized, ...config };
  await writeFile(userConfigPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
};

export const initCommand: CliCommandHandler = async (input) => {
  let url = typeof input.flags.url === "string" ? input.flags.url.trim() : "";
  let token = typeof input.flags.token === "string" ? input.flags.token.trim() : "";

  const interactive = !url || !token;

  if (interactive) {
    console.log("");
    console.log(`  ${c.bold}${c.cyan}TaskMeld${c.reset}  ${c.dim}·  ${t("init:firstTimeSetup")}${c.reset}`);
    console.log("");
    console.log(`  ${c.dim}${t("init:greeting")}${c.reset}`);
    console.log(`  ${c.dim}${t("init:configSavedTo", { path: userConfigPath })}${c.reset}`);

    hr();
    const locale = await selectPrompt(t("init:languageLabel"), [
      { value: "en", label: "English" },
      { value: "zh", label: "Chinese" },
    ]);
    await writeConfig({ locale });
    await changeLocale(locale as "en" | "zh");

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    if (!url) {
      hr();
      url = await fieldPrompt(rl, t("init:gatewayUrlLabel"), t("init:gatewayUrlHint"), "ws://127.0.0.1:18789") || "ws://127.0.0.1:18789";
    }

    if (url && !token) {
      hr();
      token = await fieldPrompt(rl, t("init:gatewayTokenLabel"), t("init:gatewayTokenHint"));
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
    console.log(`  ${c.bgGreen}${c.black}${c.bold} > ${t("init:success")} ${c.reset}`);
    console.log("");
    console.log(`  ${c.dim}${t("init:urlLabel")}${c.reset}     ${url}`);
    console.log(`  ${c.dim}Config${c.reset}  ${userConfigPath}`);
    console.log("");
    console.log(`  ${c.dim}${t("init:nextStep")}${c.reset}`);
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
    description: t("init:description"),
    handler: initCommand,
    renderHelp: () => {
      const lines = [
        "Usage:",
        `  ${t("init:usage")}`,
        "",
        "Description:",
        `  ${t("init:summary")}`,
        `  ${t("init:configSavedTo", { path: userConfigPath })}`,
        "",
        "Options:",
        `  --url <url>      ${t("init:optUrlDesc")}`,
        `  --token <token>  ${t("init:optTokenDesc")}`,
        "",
        "Examples:",
        `  ${t("init:example1")}`,
        `  ${t("init:example2")}`,
        "",
        "Notes:",
        `  ${t("init:note1")}`,
        `  ${t("init:note2")}`,
        `  ${t("init:note3")}`,
      ];
      return lines.join("\n");
    },
    help: {
      usage: t("init:usage"),
      summary: t("init:summary"),
      options: [
        { flags: ["--url"], valueName: "url", description: t("init:optUrlDesc") },
        { flags: ["--token"], valueName: "token", description: t("init:optTokenDesc") },
      ],
      examples: [
        t("init:example1"),
        t("init:example2"),
      ],
      notes: [
        t("init:note1"),
        t("init:note2"),
        t("init:note3"),
      ],
    },
  },
];
