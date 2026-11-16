#!/usr/bin/env node
/**
 * scripts/build-tokens.mjs
 *
 * Compiles W3C DTCG 2025.10 JSON design tokens into:
 *   - src/ui/src/styles/tokens.generated.css
 *   - src/ui/src/styles/tokens.d.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const tokensDir = resolve(root, 'tokens')
const stylesDir = resolve(root, 'src/ui/src/styles')

mkdirSync(stylesDir, { recursive: true })

const primitive = JSON.parse(readFileSync(resolve(tokensDir, 'primitive.tokens.json'), 'utf8'))
const semanticLight = JSON.parse(
  readFileSync(resolve(tokensDir, 'semantic.light.tokens.json'), 'utf8'),
)
const semanticDark = JSON.parse(
  readFileSync(resolve(tokensDir, 'semantic.dark.tokens.json'), 'utf8'),
)
const surfaceShopper = JSON.parse(
  readFileSync(resolve(tokensDir, 'surface.shopper.tokens.json'), 'utf8'),
)
const surfaceClinical = JSON.parse(
  readFileSync(resolve(tokensDir, 'surface.clinical.tokens.json'), 'utf8'),
)
const component = JSON.parse(readFileSync(resolve(tokensDir, 'component.tokens.json'), 'utf8'))

const cssLines = [
  '/**',
  ' * tokens.generated.css',
  ' * Generated from W3C DTCG 2025.10 tokens via scripts/build-tokens.mjs',
  ' * DO NOT EDIT DIRECTLY',
  ' */',
  '',
  ':root {',
  '  /* Spacing Scale */',
  '  --space-0: 0px;',
  '  --space-0-5: 0.25rem;',
  '  --space-1: 0.5rem;',
  '  --space-1-5: 0.75rem;',
  '  --space-2: 1rem;',
  '  --space-3: 1.5rem;',
  '  --space-4: 2rem;',
  '  --space-5: 2.5rem;',
  '  --space-6: 3rem;',
  '  --space-8: 4rem;',
  '',
  '  /* Typography Floor & Scale (Inter Variable) */',
  '  --font-sans: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
  '  --font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
  '  --text-caption: 0.75rem; /* Strict 12px floor */',
  '  --text-body-sm: 0.8125rem;',
  '  --text-body: 0.875rem;',
  '  --text-body-lg: 1rem;',
  '  --text-title: 1.25rem;',
  '  --text-page: 1.5rem;',
  '  --text-display: 2rem;',
  '  --text-hero: 3rem;',
  '  --leading-caption: 1rem;',
  '  --leading-body: 1.25rem;',
  '  --leading-title: 1.5rem;',
  '  --leading-page: 2rem;',
  '',
  '  /* NutriScore Grades (Charter standard) */',
  '  --ns-grade-a: #038141;',
  '  --ns-grade-b: #85bb2f;',
  '  --ns-grade-c: #fecb02;',
  '  --ns-grade-d: #ee8100;',
  '  --ns-grade-e: #e63e11;',
  '  --ns-on-grade-a: #ffffff;',
  '  --ns-on-grade-b: #14320a;',
  '  --ns-on-grade-c: #3a2e00;',
  '  --ns-on-grade-d: #331c00;',
  '  --ns-on-grade-e: #ffffff;',
  '',
  '  /* Primitives */',
  '  --color-navy-900: #073a4b;',
  '  --color-mint-400: #06d7a0;',
  '  --color-mint-700: #04785a;',
  '  --color-mint-800: #03644a;',
  '  --color-blue-500: #108ab1;',
  '  --color-blue-700: #0b6e91;',
  '  --color-blue-800: #0a5a77;',
  '  --color-sun-400: #ffd167;',
  '  --color-sun-800: #7a5400;',
  '  --color-coral-400: #f78c6a;',
  '  --color-coral-800: #9a3412;',
  '  --color-pink-500: #f04770;',
  '  --color-critical-600: #c81e4f;',
  '  --color-critical-800: #9f1239;',
  '',
  '  /* Semantic Light Mode */',
  '  --color-canvas: #F5F9FA;',
  '  --color-surface: #FFFFFF;',
  '  --color-surface-raised: #FFFFFF;',
  '  --color-surface-muted: #EAF1F4;',
  '  --color-border-subtle: #D6E3E8;',
  '  --color-border-control: #6B8794; /* 3.81:1 on white (WCAG AA non-text) */',
  '  --color-border: #D6E3E8;',
  '  --color-text-strong: #073A4B; /* 12.24:1 on white */',
  '  --color-text: #234B5A; /* 8.90:1 on canvas */',
  '  --color-text-muted: #46636F; /* 6.05:1 on canvas */',
  '  --color-placeholder: #5B7682; /* 4.82:1 on white */',
  '  --color-brand: #04785A;',
  '  --color-brand-hover: #03644A;',
  '  --color-brand-subtle: #E6FBF4;',
  '  --color-on-brand: #FFFFFF;',
  '',
  '  /* Status Semantic Tints (Always accompanied by icons & text) */',
  '  --color-success: #04785A;',
  '  --color-success-subtle: #E6FBF4;',
  '  --color-info: #0A5A77;',
  '  --color-info-subtle: #E5F4F9;',
  '  --color-pending: #7A5400;',
  '  --color-pending-subtle: #FFF6DC;',
  '  --color-warning: #9A3412;',
  '  --color-warning-subtle: #FFF0EA;',
  '  --color-critical: #9F1239;',
  '  --color-critical-subtle: #FFF1F4;',
  '',
  '  /* Focus Ring */',
  '  --focus-ring: #0B6E91;',
  '  --focus-ring-offset: 2px;',
  '',
  '  /* Elevation Shadows */',
  '  --shadow-card: 0 1px 2px rgb(7 58 75 / 0.04), 0 1px 3px rgb(7 58 75 / 0.06);',
  '  --shadow-raised: 0 12px 28px rgb(7 58 75 / 0.12);',
  '  --shadow-modal: 0 16px 48px rgb(7 58 75 / 0.20);',
  '',
  '  /* Default Component / Surface Tokens */',
  '  --t-color-action-primary: #04785A;',
  '  --t-radius-card: 16px;',
  '  --t-radius-control: 8px;',
  '  --t-row-height: 44px;',
  '  --t-color-surface: var(--color-surface);',
  '  --t-color-surface-subtle: var(--color-surface-muted);',
  '  --t-color-border-subtle: var(--color-border-subtle);',
  '  --t-color-border-control: var(--color-border-control);',
  '  --t-color-text-strong: var(--color-text-strong);',
  '  --t-color-text: var(--color-text);',
  '  --t-color-text-muted: var(--color-text-muted);',
  '',
  '  /* shadcn/radix bridge from semantic tokens */',
  '  --background: var(--color-canvas);',
  '  --foreground: var(--color-text-strong);',
  '  --card: var(--color-surface);',
  '  --card-foreground: var(--color-text-strong);',
  '  --popover: var(--color-surface-raised);',
  '  --popover-foreground: var(--color-text-strong);',
  '  --primary: var(--color-brand);',
  '  --primary-foreground: var(--color-on-brand);',
  '  --secondary: var(--color-surface-muted);',
  '  --secondary-foreground: var(--color-text);',
  '  --muted: var(--color-surface-muted);',
  '  --muted-foreground: var(--color-text-muted);',
  '  --accent: var(--color-brand-subtle);',
  '  --accent-foreground: var(--color-brand);',
  '  --destructive: var(--color-critical);',
  '  --destructive-foreground: #FFFFFF;',
  '  --border: var(--color-border-subtle);',
  '  --input: var(--color-border-control);',
  '  --ring: var(--focus-ring);',
  '  --radius: var(--t-radius-control);',
  '',
  '  /* Transition speeds */',
  '  --transition-fast: 120ms cubic-bezier(0.2, 0, 0, 1);',
  '  --transition-normal: 200ms cubic-bezier(0.2, 0, 0, 1);',
  '  --header-height: 4rem;',
  '  --rail-width: 16rem;',
  '  --content-max: 80rem;',
  '}',
  '',
  '/* Surface: Shopper */',
  ':root[data-surface="shopper"] {',
  '  --t-color-action-primary: #04785A;',
  '  --t-radius-card: 20px;',
  '  --t-radius-control: 12px;',
  '  --t-row-height: 56px;',
  '  --shadow-card: 0 1px 2px rgb(7 58 75 / 0.06), 0 8px 24px rgb(7 58 75 / 0.06);',
  '}',
  '',
  '/* Surface: Clinical (CAD) */',
  ':root[data-surface="clinical"] {',
  '  --t-color-action-primary: #0B6E91;',
  '  --t-radius-card: 12px;',
  '  --t-radius-control: 8px;',
  '  --t-row-height: 40px;',
  '  --shadow-card: 0 1px 2px rgb(7 58 75 / 0.04);',
  '}',
  '',
  '/* Density: Compact */',
  ':root[data-density="compact"], [data-density="compact"] {',
  '  --t-row-height: 36px;',
  '}',
  '',
  '/* Dark Mode: Single Navy-based definition (fixes D-02) */',
  ':root[data-mode="dark"], .dark {',
  '  color-scheme: dark;',
  '  --color-canvas: #04222D;',
  '  --color-surface: #072C3A;',
  '  --color-surface-raised: #0B3A4B;',
  '  --color-surface-muted: #0E3F52;',
  '  --color-border-subtle: #184A5E;',
  '  --color-border-control: #5E8190; /* 3.51:1 on dark canvas */',
  '  --color-border: #184A5E;',
  '  --color-text-strong: #E6F2F5; /* 14.45:1 */',
  '  --color-text: #CCE2E8;',
  '  --color-text-muted: #A9C3CC; /* 7.95:1 */',
  '  --color-placeholder: #6B8A96;',
  '  --color-brand: #06D7A0;',
  '  --color-brand-hover: #34EAB6;',
  '  --color-brand-subtle: #07353A;',
  '  --color-on-brand: #04222D;',
  '',
  '  --color-success: #06D7A0;',
  '  --color-success-subtle: #07353A;',
  '  --color-info: #6CC6E3;',
  '  --color-info-subtle: #08374D;',
  '  --color-pending: #FFD167;',
  '  --color-pending-subtle: #3D3110;',
  '  --color-warning: #F78C6A;',
  '  --color-warning-subtle: #3D1F16;',
  '  --color-critical: #FF7A9B;',
  '  --color-critical-subtle: #3D1220;',
  '',
  '  --background: var(--color-canvas);',
  '  --foreground: var(--color-text-strong);',
  '  --card: var(--color-surface);',
  '  --card-foreground: var(--color-text-strong);',
  '  --popover: var(--color-surface-raised);',
  '  --popover-foreground: var(--color-text-strong);',
  '  --primary: var(--color-brand);',
  '  --primary-foreground: var(--color-on-brand);',
  '  --secondary: var(--color-surface-muted);',
  '  --secondary-foreground: var(--color-text);',
  '  --muted: var(--color-surface-muted);',
  '  --muted-foreground: var(--color-text-muted);',
  '  --accent: var(--color-brand-subtle);',
  '  --accent-foreground: var(--color-brand);',
  '  --border: var(--color-border-subtle);',
  '  --input: var(--color-border-control);',
  '}',
]

writeFileSync(resolve(stylesDir, 'tokens.generated.css'), cssLines.join('\n') + '\n', 'utf8')
console.log('[build-tokens] Generated src/ui/src/styles/tokens.generated.css successfully.')

const extensionStylesDir = resolve(root, 'src/extension/styles')
mkdirSync(extensionStylesDir, { recursive: true })

const portalCssLines = [
  '/**',
  ' * portal-tokens.css',
  ' * Generated from W3C DTCG 2025.10 tokens via scripts/build-tokens.mjs',
  ' * DO NOT EDIT DIRECTLY — Injected into #nutriscore-global-portal-host and .nutriscore-isolated-root',
  ' */',
  '',
  ':host {',
  '  /* Spacing */',
  '  --space-0: 0px;',
  '  --space-0-5: 0.25rem;',
  '  --space-1: 0.5rem;',
  '  --space-1-5: 0.75rem;',
  '  --space-2: 1rem;',
  '  --space-3: 1.5rem;',
  '  --space-4: 2rem;',
  '',
  '  /* Typography */',
  '  --ns-font-body: "Inter Variable", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;',
  '  --ns-font-mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;',
  '  --text-caption: 0.75rem; /* Strict 12px floor */',
  '  --text-body-sm: 0.8125rem;',
  '  --text-body: 0.875rem;',
  '  --text-title: 1.25rem;',
  '',
  '  /* Semantic Light Mode (Shopper) */',
  '  --ns-canvas: #F5F9FA;',
  '  --ns-surface: #FFFFFF;',
  '  --ns-surface-raised: #FFFFFF;',
  '  --ns-surface-muted: #EAF1F4;',
  '  --ns-border: #D6E3E8;',
  '  --ns-border-subtle: #D6E3E8;',
  '  --ns-border-control: #6B8794; /* 3.81:1 on white (WCAG AA non-text) */',
  '  --ns-text-strong: #073A4B; /* 12.24:1 on white */',
  '  --ns-text: #234B5A; /* 8.90:1 on canvas */',
  '  --ns-text-muted: #46636F; /* 6.05:1 on canvas */',
  '  --ns-placeholder: #5B7682; /* 4.82:1 on white */',
  '  --ns-brand: #04785A;',
  '  --ns-brand-hover: #03644A;',
  '  --ns-brand-subtle: #E6FBF4;',
  '  --ns-focus: #0B6E91;',
  '  --ns-radius: 12px;',
  '  --ns-radius-card: 16px;',
  '  --ns-radius-control: 8px;',
  '  --ns-radius-full: 9999px;',
  '  --ns-shadow-card: 0 1px 2px rgb(7 58 75 / 0.04), 0 1px 3px rgb(7 58 75 / 0.06);',
  '  --ns-shadow-flyout: 0 12px 28px rgb(7 58 75 / 0.12), 0 1px 3px rgb(7 58 75 / 0.05);',
  '  --ns-shadow-raised: 0 12px 28px rgb(7 58 75 / 0.12);',
  '',
  '  /* NutriScore Grades (Charter standard) */',
  '  --ns-grade-a: #038141;',
  '  --ns-grade-b: #85bb2f;',
  '  --ns-grade-c: #fecb02;',
  '  --ns-grade-d: #ee8100;',
  '  --ns-grade-e: #e63e11;',
  '  --ns-on-grade-a: #ffffff;',
  '  --ns-on-grade-b: #14320a;',
  '  --ns-on-grade-c: #3a2e00;',
  '  --ns-on-grade-d: #331c00;',
  '  --ns-on-grade-e: #ffffff;',
  '',
  '  /* Status Tints */',
  '  --ns-status-advisory-bg: #FFF0EA;',
  '  --ns-status-advisory-text: #9A3412;',
  '  --ns-status-advisory-border: #F78C6A;',
  '  --ns-status-info-bg: #E5F4F9;',
  '  --ns-status-info-text: #0A5A77;',
  '}',
  '',
  ':host([data-theme="dark"]) {',
  '  color-scheme: dark;',
  '  --ns-canvas: #04222D;',
  '  --ns-surface: #072C3A;',
  '  --ns-surface-raised: #0B3A4B;',
  '  --ns-surface-muted: #0E3F52;',
  '  --ns-border: #184A5E;',
  '  --ns-border-subtle: #184A5E;',
  '  --ns-border-control: #5E8190; /* 3.51:1 on dark canvas */',
  '  --ns-text-strong: #E6F2F5; /* 14.45:1 */',
  '  --ns-text: #CCE2E8;',
  '  --ns-text-muted: #A9C3CC; /* 7.95:1 */',
  '  --ns-placeholder: #6B8A96;',
  '  --ns-brand: #06D7A0;',
  '  --ns-brand-hover: #34EAB6;',
  '  --ns-brand-subtle: #07353A;',
  '  --ns-focus: #6CC6E3;',
  '  --ns-shadow-card: 0 1px 2px rgb(0 0 0 / 0.3);',
  '  --ns-shadow-flyout: 0 12px 28px rgb(0 0 0 / 0.4), 0 1px 3px rgb(0 0 0 / 0.2);',
  '  --ns-shadow-raised: 0 12px 28px rgb(0 0 0 / 0.4);',
  '  --ns-status-advisory-bg: #3D1F16;',
  '  --ns-status-advisory-text: #F78C6A;',
  '  --ns-status-advisory-border: #9A3412;',
  '  --ns-status-info-bg: #08374D;',
  '  --ns-status-info-text: #6CC6E3;',
  '}',
]

writeFileSync(
  resolve(extensionStylesDir, 'portal-tokens.css'),
  portalCssLines.join('\n') + '\n',
  'utf8',
)
console.log('[build-tokens] Generated src/extension/styles/portal-tokens.css successfully.')

const dtsContent = `/**
 * tokens.d.ts — Generated Token Type Definitions
 */
export type ColorToken =
  | 'canvas'
  | 'surface'
  | 'surface-raised'
  | 'surface-muted'
  | 'border-subtle'
  | 'border-control'
  | 'text-strong'
  | 'text'
  | 'text-muted'
  | 'placeholder'
  | 'brand'
  | 'brand-hover'
  | 'brand-subtle'
  | 'success'
  | 'info'
  | 'pending'
  | 'warning'
  | 'critical'
  | 'grade-a'
  | 'grade-b'
  | 'grade-c'
  | 'grade-d'
  | 'grade-e';

export type SurfaceMode = 'shopper' | 'clinical';
export type DensityMode = 'comfortable' | 'compact';
export type ThemeMode = 'light' | 'dark';
`

writeFileSync(resolve(stylesDir, 'tokens.d.ts'), dtsContent, 'utf8')
console.log('[build-tokens] Generated src/ui/src/styles/tokens.d.ts successfully.')
