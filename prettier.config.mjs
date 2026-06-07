/**
 * Prettier configuration
 *
 * 前后端风格差异：后端无分号，前端有分号。
 * 通过 overrides 按文件路径区分。
 */
export default {
  // ====== 默认（后端 src/ + test/） ======
  semi: false,
  singleQuote: false,
  trailingComma: "all",
  tabWidth: 2,
  printWidth: 120,
  endOfLine: "lf",

  // ====== 按路径覆盖 ======
  overrides: [
    {
      // 前端：有分号
      files: ["web/src/**/*.{ts,tsx,js,jsx}", "web/*.config.*"],
      options: {
        semi: true,
      },
    },
  ],
};
