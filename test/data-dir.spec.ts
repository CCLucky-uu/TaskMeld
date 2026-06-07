import assert from "node:assert/strict"
import { join } from "node:path"
import { getTaskMeldDataDir } from "../src/app/data-dir"

const run = () => {
  const cwd = join("E:", "workspace", "taskmeld")
  const homeDir = join("C:", "Users", "a")

  assert.equal(
    getTaskMeldDataDir({
      env: {},
      argv: ["node", "dist/src/cli/index.js"],
      cwd,
      homeDir,
    }),
    join(homeDir, ".taskmeld"),
    "发布态默认应使用用户目录 ~/.taskmeld",
  )

  assert.equal(
    getTaskMeldDataDir({
      env: { TASKMELD_TEST_MODE: "1" },
      argv: ["node", "dist/src/cli/index.js"],
      cwd,
      homeDir,
    }),
    join(cwd, ".data"),
    "测试态应使用当前工作区 .data",
  )

  assert.equal(
    getTaskMeldDataDir({
      env: {},
      argv: ["node", "node_modules/.bin/tsx", "src/index.ts"],
      cwd,
      homeDir,
    }),
    join(cwd, ".data"),
    "tsx 开发态应使用当前工作区 .data",
  )

  assert.equal(
    getTaskMeldDataDir({
      env: { TASKMELD_DATA_DIR: join("D:", "taskmeld-data") },
      argv: ["node", "dist/src/cli/index.js"],
      cwd,
      homeDir,
    }),
    join("D:", "taskmeld-data"),
    "显式数据目录应优先于默认规则",
  )

  console.log("data-dir tests passed")
}

run()
