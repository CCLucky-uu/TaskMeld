import { homedir } from "node:os";
import { join } from "node:path";

const TEST_ARG_PATTERN = /(^|[\\/])(test|dist[\\/]test)[\\/]/;
// 检测 tsx / ts-node 等开发态运行（如 `npx tsx src/index.ts`）
const DEV_ARG_PATTERN = /(^|[\\/])tsx[\\/]|(^|[\\/])(src[\\/]index\.ts)$/;

type DataDirEnv = Record<string, string | undefined>;

export type TaskMeldDataDirOptions = {
  env?: DataDirEnv;
  argv?: readonly string[];
  cwd?: string;
  homeDir?: string;
};

export const isTaskMeldTestRuntime = (options: Pick<TaskMeldDataDirOptions, "env" | "argv"> = {}): boolean => {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  if (env.TASKMELD_TEST_MODE === "1" || env.NODE_ENV === "test") {
    return true;
  }
  return argv.some((arg) => TEST_ARG_PATTERN.test(arg));
};

export const isTaskMeldDevRuntime = (options: Pick<TaskMeldDataDirOptions, "env" | "argv"> = {}): boolean => {
  const env = options.env ?? process.env;
  const argv = options.argv ?? process.argv;
  if (env.NODE_ENV === "development") return true;
  return argv.some((arg) => DEV_ARG_PATTERN.test(arg));
};

export const getTaskMeldDataDir = (options: TaskMeldDataDirOptions = {}): string => {
  const env = options.env ?? process.env;
  const override = env.TASKMELD_DATA_DIR?.trim();
  if (override) return override;

  // 测试/开发用例默认隔离到当前仓库，避免污染用户真实的 ~/.taskmeld 数据。
  if (isTaskMeldTestRuntime({ env, argv: options.argv }) || isTaskMeldDevRuntime({ env, argv: options.argv })) {
    return join(options.cwd ?? process.cwd(), ".data");
  }

  return join(options.homeDir ?? homedir(), ".taskmeld");
};

export const resolveTaskMeldDataPath = (...segments: string[]): string =>
  join(getTaskMeldDataDir(), ...segments);
