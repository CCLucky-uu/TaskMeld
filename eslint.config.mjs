import js from "@eslint/js";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import prettierConfig from "eslint-config-prettier";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  // ====== 全局忽略 ======
  {
    ignores: ["dist/**", "node_modules/**", "web/node_modules/**", "test/control-plane-utils.web.spec.ts"],
  },
  js.configs.recommended,

  // ====== 后端 src/ ======
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      // TypeScript — 抓 bug + 代码质量
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-definitions": ["warn", "type"],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": ["warn", { checksVoidReturn: false }],

      // 代码质量
      complexity: ["warn", 15],
      "no-constant-condition": ["warn", { checkLoops: false }],

      // 关闭与 TypeScript 冲突的规则
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-control-regex": "off",
    },
  },

  // ====== 测试 test/ ======
  {
    files: ["test/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-control-regex": "off",
      complexity: "off",
    },
  },

  // ====== 前端 web/src/ ======
  {
    files: ["web/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
        project: "./web/tsconfig.json",
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      // TypeScript — 抓 bug + 代码质量
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/consistent-type-definitions": ["warn", "type"],
      "@typescript-eslint/no-floating-promises": "warn",
      "@typescript-eslint/no-misused-promises": ["warn", { checksVoidReturn: false }],

      // React — hooks 安全
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "react/jsx-no-useless-fragment": "warn",
      "react/self-closing-comp": "warn",

      // 代码质量
      complexity: ["warn", 15],

      // 关闭与 React 17+ JSX transform 冲突的规则
      "react/react-in-jsx-scope": "off",
      "react/jsx-uses-react": "off",
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-control-regex": "off",
    },
  },

  // ====== Prettier 兜底（关闭所有与 Prettier 冲突的格式规则） ======
  prettierConfig,
];
