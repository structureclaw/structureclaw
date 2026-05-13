import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: ["dist/", "node_modules/"],
  },

  // 1️⃣ 基础 JS 推荐规则
  js.configs.recommended,

  // 2️⃣ TypeScript 推荐规则（包含 parser + plugin）
  ...tseslint.configs.recommended,

  // 3️⃣ 你自己的配置
  {
    files: ["**/*.ts", "**/*.tsx"],

    languageOptions: {
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
      },
    },

    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],

      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
