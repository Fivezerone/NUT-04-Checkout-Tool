import globals from 'globals'
import pluginJs from '@eslint/js'
import tseslint from 'typescript-eslint'
import pluginReactHooks from 'eslint-plugin-react-hooks'
import pluginSecurity from 'eslint-plugin-security'

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'android/**',
      'server/**',
      'Reports/**',
      'src/extension/db.js',
      'src/extension/supabase.js',
      'src/extension/data/**',
      'data/**',
      'Docs/**',
      'NUT-04_Release_Documentation/**',
      '*.cjs',
      'fix_dashboard.*',
      'patch_datasets.*',
      'debug.*',
      'test_*.cjs',
      'test_*.js',
      'test-import.*',
      'eslint-report.*',
      'publish-report.json',
      'src/ui/src/app/__tests__/**',
      'supabase/**',
    ],
  },
  pluginJs.configs.recommended,
  pluginSecurity.configs.recommended,
  {
    files: ['scripts/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.es2021,
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  {
    files: ['src/shared/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        ...globals.node,
        chrome: 'readonly',
      },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'warn',
    },
  },
  {
    files: ['src/ui/public/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-empty': 'warn',
    },
  },
  {
    files: ['src/extension/**/*.js'],
    languageOptions: {
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.webextensions,
        NutriSharedUI: 'readonly',
        NutriScoreDB: 'readonly',
        NutriScanner: 'readonly',
        NutriCatalogSync: 'readonly',
        NutriEntitlement: 'readonly',
        NutriSupabase: 'readonly',
        chrome: 'readonly',
      },
    },
    rules: {
      complexity: ['warn', 10],
      'max-lines-per-function': ['warn', 150],
      'no-undef': 'off',
      'no-unused-vars': 'warn',
      'no-redeclare': 'warn',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ['src/ui/src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
  })),
  {
    files: ['src/ui/src/**/*.{ts,tsx}', 'scripts/**/*.ts'],
    plugins: {
      'react-hooks': pluginReactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      complexity: ['warn', 10],
      'max-lines-per-function': ['warn', 150],
      'security/detect-object-injection': 'warn',
    },
  },
]
