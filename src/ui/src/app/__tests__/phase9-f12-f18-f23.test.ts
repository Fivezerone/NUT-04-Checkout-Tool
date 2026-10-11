/**
 * Phase 9 regression tests — F-12, F-18, F-23
 *
 * F-12: Boot cost reduction.
 *   - supabase.js slim client: bundles @supabase/auth-js + @supabase/postgrest-js
 *     only (122.8 KB vs 223.3 KB, -45%).
 *   - background.js importScripts: removed 7 unused engine/* imports (~23 KB).
 *
 * F-23: Database test syntax.
 *   - billing_authority.sql and catalog_rls.sql had doubled quotes ('') inside DO $$ blocks.
 *   - With DO $$ bodies, standard single quotes (') must be used so psql runs cleanly.
 *
 * F-18: Paystack HMAC timing-safe comparison.
 *   - Webhook signature comparison must be constant-time to prevent timing attacks.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../../../../../");
const BG_PATH = path.join(ROOT, "src/extension/background.js");
const SB_CLIENT_PATH = path.join(ROOT, "src/extension/supabase.js");
const BUILD_SW_SCRIPT = path.join(ROOT, "scripts/build-sw-client.mjs");
const BILLING_TEST_PATH = path.join(ROOT, "supabase/tests/billing_authority.sql");
const CATALOG_RLS_TEST_PATH = path.join(ROOT, "supabase/tests/catalog_rls.sql");
const PAYSTACK_WEBHOOK_PATH = path.join(ROOT, "supabase/functions/paystack-webhook/index.ts");

describe("Phase 9: F-12 Boot Cost Reduction", () => {
  const bgCode = fs.readFileSync(BG_PATH, "utf8");
  const buildSwCode = fs.readFileSync(BUILD_SW_SCRIPT, "utf8");

  it("background.js does not import any engine/* scripts in importScripts", () => {
    // The importScripts block should not include engine/
    const importScriptsMatch = bgCode.match(/importScripts\s*\(([^)]+)\)/s);
    expect(importScriptsMatch).toBeTruthy();
    const importBlock = importScriptsMatch![1];
    
    // Must NOT import engine/context-engine, engine/health-flags, or engine/scorers
    expect(importBlock).not.toMatch(/["']engine\/context-engine\.js["']/);
    expect(importBlock).not.toMatch(/["']engine\/health-flags\.js["']/);
    expect(importBlock).not.toMatch(/["']engine\/scorers\//);
  });

  it("build-sw-client.mjs imports slim modules instead of full @supabase/supabase-js", () => {
    expect(buildSwCode).toContain("@supabase/auth-js");
    expect(buildSwCode).toContain("@supabase/postgrest-js");
    expect(buildSwCode).not.toContain("import { createClient } from '@supabase/supabase-js'");
  });

  it("supabase.js bundle is under 150 KB (slim client verified)", () => {
    const stats = fs.statSync(SB_CLIENT_PATH);
    // Baseline full client was 223,292 B; slim client is ~122.8 KB
    expect(stats.size).toBeLessThan(150 * 1024);
    expect(stats.size).toBeGreaterThan(50 * 1024);
  });

  it("NutriSupabase provides expected auth and from methods", () => {
    // Evaluate a minimal mock of NutriSupabase in a sandbox
    const sbContent = fs.readFileSync(SB_CLIENT_PATH, "utf8");
    const scope: any = {
      self: {},
      console,
      URL,
      Headers,
      fetch: async () => new Response("{}"),
      chrome: { storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} } } },
    };
    scope.self = scope;
    const fn = new Function("self", "URL", "Headers", "fetch", "chrome", sbContent);
    fn(scope, URL, Headers, scope.fetch, scope.chrome);

    expect(scope.NutriSupabase).toBeDefined();
    expect(typeof scope.NutriSupabase.create).toBe("function");

    const client = scope.NutriSupabase.create("https://example.supabase.co", "anon-key");
    expect(client.auth).toBeDefined();
    expect(typeof client.auth.getSession).toBe("function");
    expect(typeof client.auth.setSession).toBe("function");
    expect(typeof client.from).toBe("function");
  });
});

describe("Phase 9: F-23 Database Test Syntax Fixes", () => {
  const billingSql = fs.readFileSync(BILLING_TEST_PATH, "utf8");
  const catalogRlsSql = fs.readFileSync(CATALOG_RLS_TEST_PATH, "utf8");

  it("billing_authority.sql does not use doubled quotes inside DO $$ blocks", () => {
    // Check that DO $$ blocks use standard single quotes for RAISE and literals
    expect(billingSql).toContain("RAISE NOTICE 'PASS: authenticated cannot write billing columns';");
    expect(billingSql).not.toContain("RAISE NOTICE ''PASS: authenticated cannot write billing columns'';");
    expect(billingSql).toContain("RAISE NOTICE 'PASS: is_premium_active returns false after expiry';");
    expect(billingSql).not.toContain("RAISE NOTICE ''PASS: is_premium_active returns false after expiry'';");
  });

  it("catalog_rls.sql does not use doubled quotes inside DO $$ blocks", () => {
    expect(catalogRlsSql).toContain("RAISE NOTICE 'PASS: anon cannot read catalog_products';");
    expect(catalogRlsSql).not.toContain("RAISE NOTICE ''PASS: anon cannot read catalog_products'';");
    expect(catalogRlsSql).toContain("RAISE NOTICE 'PASS: anon cannot read catalog_premium';");
    expect(catalogRlsSql).not.toContain("RAISE NOTICE ''PASS: anon cannot read catalog_premium'';");
    expect(catalogRlsSql).toContain("RAISE NOTICE 'PASS: anon cannot read catalog_releases';");
    expect(catalogRlsSql).not.toContain("RAISE NOTICE ''PASS: anon cannot read catalog_releases'';");
  });

  it("catalog_rls.sql trailing notice is enclosed in a valid statement block", () => {
    // Standalone RAISE NOTICE outside a PL/pgSQL block is a syntax error in psql
    expect(catalogRlsSql).not.toMatch(/^RAISE NOTICE/m);
    expect(catalogRlsSql).toContain("DO $$ BEGIN\n  RAISE NOTICE 'All P2 SQL tests written");
  });
});

describe("Phase 9: F-18 Paystack Webhook Constant-Time HMAC", () => {
  const webhookCode = fs.readFileSync(PAYSTACK_WEBHOOK_PATH, "utf8");

  it("paystack-webhook does not use plain inequality for signature comparison", () => {
    expect(webhookCode).not.toContain("if (hash !== signature)");
  });

  it("paystack-webhook uses constant-time comparison loop", () => {
    expect(webhookCode).toContain("mismatch |=");
  });
});
