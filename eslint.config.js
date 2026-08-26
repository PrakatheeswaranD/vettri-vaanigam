// @ts-check
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/build/**",
      "**/node_modules/**",
      "**/.dbdata/**",
      "**/coverage/**",
      "apps/api/prisma/migrations/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  // apps/web — React-specific rules
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
    },
  },
  // Config/tooling files run under Node without the app tsconfig. These
  // are plain JS (not TypeScript), so unlike .ts files — where
  // typescript-eslint's recommended config turns off `no-undef` because
  // the TS compiler already catches undefined identifiers — ESLint's own
  // `no-undef` rule is still active here and needs to know about Node's
  // global runtime identifiers explicitly.
  {
    files: ["*.config.{js,ts,mjs}", "scripts/**/*.mjs", "scripts/**/*.ts"],
    languageOptions: {
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "off",
      // These are CLI/dev-tooling scripts, not application request-
      // handling code — console output here is the actual UX (startup
      // status, restart notices), not a debug leftover.
      "no-console": "off",
    },
  },
);
