import { homedir } from "node:os";
import { join } from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";

export type UserConfig = {
  gatewayUrl?: string;
  gatewayToken?: string;
};

const userConfigDir = join(homedir(), ".taskmeld");
const userConfigPath = join(userConfigDir, "config.json");

export const readUserConfig = async (): Promise<UserConfig> => {
  try {
    const raw = await readFile(userConfigPath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return {
      gatewayUrl: typeof parsed.gatewayUrl === "string" ? parsed.gatewayUrl.trim() : undefined,
      gatewayToken: typeof parsed.gatewayToken === "string" ? parsed.gatewayToken.trim() : undefined,
    };
  } catch {
    return {};
  }
};

export const writeUserConfig = async (config: UserConfig): Promise<void> => {
  await mkdir(userConfigDir, { recursive: true });
  const existing = await readUserConfig();
  const merged = { ...existing, ...config };
  await writeFile(userConfigPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
};

export const resolveGatewayConfig = async (): Promise<{ url: string | null; token: string | null }> => {
  const userConfig = await readUserConfig();
  return {
    url: process.env.OPENCLAW_GATEWAY_URL?.trim() || userConfig.gatewayUrl || null,
    token: process.env.OPENCLAW_GATEWAY_TOKEN?.trim() || userConfig.gatewayToken || null,
  };
};
