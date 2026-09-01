import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // React-compiler-era strictness: the classic fetch-in-effect pattern is
      // used deliberately across views; revisit when adopting the compiler.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/use-memo": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "jest.config.js",
    "lib/db/migrations/**",
  ]),
]);

export default eslintConfig;
