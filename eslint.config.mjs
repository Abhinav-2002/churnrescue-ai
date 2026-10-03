import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // Reason: better-sqlite3 queries return unknown, requiring heavy casting in a JS-heavy codebase
      "@typescript-eslint/no-explicit-any": "off",
      // Reason: prototyping includes many unused variables
      "@typescript-eslint/no-unused-vars": "off",
      "prefer-const": "off",
      "@typescript-eslint/no-require-imports": "off"
    }
  }
]);

export default eslintConfig;
