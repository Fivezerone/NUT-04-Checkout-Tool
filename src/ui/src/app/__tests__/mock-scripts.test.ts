/**
 * Phase 7 Unit Test: Mock Identity Seeding & Purge Safety Gates
 *
 * Verifies:
 * 1. seed-mock-users.mjs refuses to execute against remote/production environments.
 * 2. purge-mocks.mjs implements --check-clean CI release gate.
 * 3. Mock users use the reserved RFC 2606 .test domain exclusively.
 * 4. .mock-credentials.json is git-ignored and never committed.
 */

import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve, join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');

describe('Phase 7 — Mock Scripts & CI Release Gate', () => {
  const seedScriptSrc = readFileSync(join(REPO_ROOT, 'scripts', 'seed-mock-users.mjs'), 'utf8');
  const purgeScriptSrc = readFileSync(join(REPO_ROOT, 'scripts', 'purge-mocks.mjs'), 'utf8');
  const gitignoreSrc = readFileSync(join(REPO_ROOT, '.gitignore'), 'utf8');

  test('seed-mock-users.mjs has production safety gate checking local URLs', () => {
    expect(seedScriptSrc).toContain("REFUSING TO RUN");
    expect(seedScriptSrc).toContain("isLocal");
    expect(seedScriptSrc).toContain("127.0.0.1");
    expect(seedScriptSrc).toContain("localhost");
    expect(seedScriptSrc).toContain("process.exit(1)");
  });

  test('purge-mocks.mjs supports --check-clean release gate', () => {
    expect(purgeScriptSrc).toContain("--check-clean");
    expect(purgeScriptSrc).toContain("CI RELEASE GATE");
    expect(purgeScriptSrc).toContain("mockUsers.length");
  });

  test('mock scripts contain only neutral RFC 2606 fixture identities', () => {
    expect(seedScriptSrc).toContain("tenant.admin@clinic.test");
    expect(seedScriptSrc).toContain("clinician.one@clinic.test");
    expect(seedScriptSrc).toContain("patient.alpha@clinic.test");
    expect(seedScriptSrc).toContain("patient.beta@clinic.test");
    expect(seedScriptSrc).toContain("partner.stakeholder@clinic.test");
    expect(seedScriptSrc).toContain("regulator.dha@platform.test");
    expect(seedScriptSrc).toContain("regulator.odpc@platform.test");
    expect(seedScriptSrc).not.toContain("Alice Mumo");
    expect(seedScriptSrc).not.toContain("Joseph Mwangi");
    expect(seedScriptSrc).not.toContain("patient_diabetes");
    expect(seedScriptSrc).not.toContain("patient_hypertension");
    expect(seedScriptSrc).not.toContain("@gmail.com");
    expect(seedScriptSrc).not.toContain("@nutriscore.co.ke"); // Super admin is bootstrap, not mock test
  });

  test('.mock-credentials.json is explicitly ignored in .gitignore', () => {
    expect(gitignoreSrc).toContain(".mock-credentials.json");
  });
});
