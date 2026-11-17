import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    ".next-admin-qa/**",
    ".admin-local/**",
    ".admin-postgres/**",
    "qa/**",
    "data/manual-klook-html/**",
    "next-env.d.ts",
  ]),
]);
