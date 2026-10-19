import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import pluginReactHooks from "eslint-plugin-react-hooks";
import pluginSecurity from "eslint-plugin-security";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "src/extension/db.js"]
  },
  pluginJs.configs.recommended,
  pluginSecurity.configs.recommended,
  {
    files: ["src/extension/**/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        NutriSharedUI: "readonly",
        NutriScoreDB: "readonly",
        chrome: "readonly"
      }
    },
    rules: {
      "complexity": ["warn", 10],
      "max-lines-per-function": ["warn", 150],
      "no-undef": "off" 
    }
  },
  ...tseslint.configs.recommended.map(config => ({
    ...config,
    files: ["src/ui/src/**/*.{ts,tsx}"]
  })),
  {
    files: ["src/ui/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": pluginReactHooks
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "complexity": ["warn", 10],
      "max-lines-per-function": ["warn", 150]
    }
  }
];
