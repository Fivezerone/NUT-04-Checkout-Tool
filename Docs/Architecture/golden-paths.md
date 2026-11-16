# Living Architectural Blueprint: Golden Paths (How-To Patterns)

## Purpose & Scope
This guide provides the definitive step-by-step "Golden Paths" for developing within the **NUT-04 Checkout Tool** repository. When making modifications or adding new features, you **must** follow these concrete patterns. Every path references real repository file paths and adheres strictly to the architectural decisions and automated CI guardrails.

---

## Golden Path 1: Adding or Modifying a Backend API Endpoint

The backend API microservice is housed in `services/api/` (Node.js 22 LTS, Fastify/HTTP) and reverse-proxied behind Caddy at `/api/v1/*` or PostgREST at `/api/*`.

### Step-by-Step Procedure:

1. **Implement the Endpoint Handler:**
   Open [services/api/src/server.mjs](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/services/api/src/server.mjs) and register your route handler:
   ```javascript
   // services/api/src/server.mjs
   if (url.pathname === '/api/v1/prescription/verify' && req.method === 'POST') {
     let body = '';
     req.on('data', chunk => { body += chunk; });
     req.on('end', () => {
       try {
         const payload = JSON.parse(body);
         // 1. Validate authorization header & JWT claims
         // 2. Perform business logic / cryptographic verification
         res.writeHead(200, { 'Content-Type': 'application/json' });
         res.end(JSON.stringify({ verified: true, timestamp: new Date().toISOString() }));
       } catch (err) {
         res.writeHead(400, { 'Content-Type': 'application/json' });
         res.end(JSON.stringify({ error: 'invalid_payload' }));
       }
     });
     return;
   }
   ```

2. **Verify Gateway Routing in Caddyfile:**
   If your route introduces a new path prefix, verify [infra/caddy/Caddyfile](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/infra/caddy/Caddyfile):
   ```caddy
   # Standard API routing forwards to PostgREST on port 3000
   handle /api/* {
       uri strip_prefix /api
       reverse_proxy postgrest:3000
   }

   # Dedicated Node.js API service routes on port 4000
   handle /api/v1/* {
       reverse_proxy api:4000
   }
   ```

3. **Verify Health Probes & Run via Docker:**
   Execute tests inside the container toolchain (Rule R4):
   ```powershell
   .\bin\nut.ps1 up -d api
   docker compose exec api curl -fs http://localhost:4000/health
   ```

---

## Golden Path 2: Modifying Database Schemas via dbmate

Database migrations are managed as plain PostgreSQL SQL files using `dbmate` (ADR-007). Migrations reside in `db/migrations/`.

### Step-by-Step Procedure:

1. **Create the Migration & Companion Rollback Files:**
   Generate the timestamped migration pair:
   - Migration: `db/migrations/YYYYMMDDHHMMSS_add_new_clinical_feature.sql`
   - Rollback: `db/migrations/YYYYMMDDHHMMSS_add_new_clinical_feature.rollback.sql`

2. **Write the Migration SQL:**
   Structure the migration using explicit schemas (`iam`, `clinical`, `exchange`, `commercial`, or `audit`) and enforce Row Level Security:
   ```sql
   -- migrate:up
   -- db/migrations/YYYYMMDDHHMMSS_add_new_clinical_feature.sql
   BEGIN;

   CREATE TABLE IF NOT EXISTS clinical.prescriptions (
       id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
       tenant_id UUID NOT NULL REFERENCES iam.tenants(id) ON DELETE CASCADE,
       patient_id UUID NOT NULL REFERENCES clinical.patient_records(id) ON DELETE RESTRICT,
       created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
       retain_until TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '20 years')
   );

   -- Mandatory Row Level Security
   ALTER TABLE clinical.prescriptions ENABLE ROW LEVEL SECURITY;
   ALTER TABLE clinical.prescriptions FORCE ROW LEVEL SECURITY;

   CREATE POLICY tenant_isolation_prescriptions ON clinical.prescriptions
       FOR ALL
       TO authenticated
       USING (tenant_id = (app_private.claims()->>'tenant_id')::uuid)
       WITH CHECK (tenant_id = (app_private.claims()->>'tenant_id')::uuid);

   GRANT SELECT, INSERT, UPDATE ON clinical.prescriptions TO authenticated;
   REVOKE DELETE ON clinical.prescriptions FROM authenticated;

   COMMIT;
   ```

3. **Write the Companion Rollback SQL:**
   ```sql
   -- migrate:down
   -- db/migrations/YYYYMMDDHHMMSS_add_new_clinical_feature.rollback.sql
   BEGIN;
   DROP TABLE IF EXISTS clinical.prescriptions CASCADE;
   COMMIT;
   ```

4. **Apply and Test the Migration via Docker:**
   ```powershell
   # Apply migration
   docker compose run --rm migrate up
   
   # Verify clean rollback and re-apply
   docker compose run --rm migrate down
   docker compose run --rm migrate up
   ```

---

## Golden Path 3: Adding or Updating a Supermarket Retailer Adapter

Retailer adapters reside in `src/extension/adapters/` and must adhere to the `Adapter` contract (ADR-013).

### Step-by-Step Procedure:

1. **Implement the Adapter Contract:**
   Create or modify your adapter in [src/extension/adapters/](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/extension/adapters/):
   ```javascript
   // src/extension/adapters/myretailer.js
   export const MyRetailerAdapter = {
     getRetailerCode() {
       return 'myretailer';
     },

     getObserveTarget() {
       // Observe body to ensure SPAs don't lose observers on route transitions
       return document.body;
     },

     candidatesIn(root) {
       // ALWAYS use Anchor-First discovery ascending via .closest()
       const anchors = root.querySelectorAll("a[href*='/product/'], a[href*='/p/']");
       const cards = new Set();
       anchors.forEach(a => {
         const card = a.closest('.product-card, [data-sku]');
         if (card) cards.add(card);
       });
       return Array.from(cards);
     },

     extractProductRef(card) {
       const anchor = card.querySelector("a[href*='/product/']");
       return {
         id: card.getAttribute('data-product-id') || anchor?.href,
         name: card.querySelector('.title, h3')?.textContent?.trim() || '',
         retailerCode: 'myretailer'
       };
     },

     inject(card, scoreResult) {
       // Render strictly inside Shadow DOM to isolate styles
       NutriSharedUI._ensureGlobalPortal(card, scoreResult);
     },

     extractCartState() {
       // Return current items in cart [{ sku, name, quantity, price }]
     },

     detectOrderConfirmation() {
       return window.location.pathname.includes('/checkout/success');
     }
   };
   ```

2. **Register in Adapter Factory:**
   Add domain matching in [src/extension/adapters/adapter-factory.js](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/extension/adapters/adapter-factory.js).

3. **Add JSDOM Contract & Fixture Tests:**
   Add DOM snapshot unit tests in [src/ui/src/app/__tests__/](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/app/__tests__/) to assert that `candidatesIn`, `extractProductRef`, and badge injection succeed without DOM leakage.

---

## Golden Path 4: Creating a UI Component or CAD View

All UI components must utilize the 3-Tier Design System tokens and WCAG 2.1 AA accessible primitives (ADR-011).

### Step-by-Step Procedure:

1. **Create Accessible Primitive / Component:**
   Place new shared primitives in [src/ui/src/app/components/ui/](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/app/components/ui/):
   - Reference semantic CSS custom properties (`var(--t-color-...)`) defined in [src/ui/src/styles/tokens.css](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/styles/tokens.css).
   - Ensure color contrast exceeds 4.5:1.
   - Include explicit ARIA labels and keyboard focus outlines.

2. **Create New Clinic Admin Dashboard View:**
   Create the view file in [src/ui/src/cad/views/](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/cad/views/) (e.g., `PatientCareSummaryView.tsx`):
   ```tsx
   import React from 'react';
   import { KpiCard } from '../../app/components/ui/KpiCard';
   import { GradeBadge } from '../../app/components/ui/GradeBadge';

   export const PatientCareSummaryView: React.FC = () => {
     return (
       <div className="p-6 space-y-6">
         <header>
           <h1 className="text-2xl font-bold text-[var(--t-color-text-primary)]">
             Patient Care Summary
           </h1>
           <p className="text-sm text-[var(--t-color-text-muted)]">
             Clinician prescription adherence and aggregate dietary trends
           </p>
         </header>
         {/* Render empty state when data is not yet loaded */}
         <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
           <KpiCard title="Active Target Bundles" value="—" status="neutral" />
           <KpiCard title="Adherence Rate (30d)" value="—" status="neutral" />
           <KpiCard title="NutriScore Average" value="—" status="neutral" />
         </div>
       </div>
     );
   };
   ```

3. **Register View in Navigation and Router:**
   - Add view key to [src/ui/src/cad/navigation.ts](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/cad/navigation.ts).
   - Add route branch in [src/ui/src/cad/CadApp.tsx](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/cad/CadApp.tsx).

---

## Golden Path 5: Updating Nutritional Rules & Health Modes

Nutritional thresholds and clinical modes are versioned and managed in `src/shared/health-modes.mjs`.

### Step-by-Step Procedure:

1. **Edit the Shared Health Modes:**
   Open [src/shared/health-modes.mjs](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/shared/health-modes.mjs) and adjust or define the nutritional rules:
   ```javascript
   export const HEALTH_MODES = {
     hypertension_support: {
       id: 'hypertension_support',
       label: 'Cardiovascular Support Mode',
       rules: [
         {
           metric: 'sodium_mg',
           operator: 'lte',
           threshold: 400, // mg per 100g
           severity: 'critical',
           rationale: 'Exceeds clinician sodium threshold for cardiovascular management'
         }
       ]
     }
   };
   ```

2. **Re-generate the Extension Health Modes File:**
   Compile the shared rules into the extension engine:
   ```powershell
   docker compose exec toolchain node scripts/build-health-modes.mjs
   ```

3. **Run Regression Tests:**
   Verify that tests in [src/ui/src/app/__tests__/disease-engine-dynamic-rules.test.ts](file:///c:/Users/USER/Documents/NUT-04%20Checkout%20Tool/src/ui/src/app/__tests__/disease-engine-dynamic-rules.test.ts) pass:
   ```powershell
   docker compose exec toolchain npm run test
   ```

---

## Golden Path 6: Testing & Quality Validation via Docker (Host Isolation)

To obey Rule R4, all verification is performed using Docker containers.

### Mandatory Pre-Merge Test Commands:

| Action | PowerShell Command (Windows) | Bash Command (POSIX) |
|---|---|---|
| **Run Full CI Suite** | `.\bin\nut.ps1 ci` | `./bin/nut ci` |
| **Run TypeScript Typecheck**| `docker compose exec toolchain npm run typecheck` | `docker compose exec toolchain npm run typecheck` |
| **Run ESLint Linter** | `docker compose exec toolchain npm run lint` | `docker compose exec toolchain npm run lint` |
| **Run Vitest Unit Suite** | `docker compose exec toolchain npm run test` | `docker compose exec toolchain npm run test` |
| **Run Hardcoded Data Check**| `docker compose exec toolchain node scripts/check-no-hardcoded-data.mjs` | `docker compose exec toolchain node scripts/check-no-hardcoded-data.mjs` |
| **Verify Audit Hash Chain**| `docker compose exec toolchain node scripts/verify-audit-chain.mjs` | `docker compose exec toolchain node scripts/verify-audit-chain.mjs` |
| **Build Extension Dist** | `.\bin\nut.ps1 extension` | `./bin/nut extension` |

