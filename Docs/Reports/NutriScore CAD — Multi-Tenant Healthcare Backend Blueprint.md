# NutriScore CAD — Multi-Tenant Healthcare Backend Blueprint

Prepared for Kibet · NUT-04 / Clinic Admin Dashboard · 31 October 2026

Builds on SOP-CAD-SEC-001, the CAD Rollback Final Report and the Phase 0 Inventory (branch `feat/cad-only-identity`). Role names follow the CAD (`super_admin`, `tenant_admin` …), not the brief’s shorthand.

## 0. Scope, decisions and reconciliations

### 0.1 Decisions at a glance

| Concern | Decision | Why |
| --- | --- | --- |
| Tenancy | Shared database, `tenant_id` discriminator, `FORCE ROW LEVEL SECURITY`, one restrictive tenant-wall policy per table | Matches the shipped CAD; cheapest to run. A silo tier (database-per-tenant) stays open for large hospitals because the schema is identical |
| Data zones | Separate Postgres clusters: **clinical-db** (PHI), **commercial-db** (de-identified), **exchange-db**, **audit-db** | RLS is the last line of defence, not the only one. The commercial zone cannot reach PHI even if a policy is wrong |
| Identity provider | Keycloak, OIDC, Authorization Code + PKCE | The shipped `custom_access_token_hook` maps 1:1 to Keycloak protocol mappers, so claim names and RLS helpers survive the move off Supabase Auth |
| Authorisation | RBAC permission sets + ABAC (treatment relationship, licence, consent, break-glass) | Three layers: gateway, service policy library, database RLS |
| Edge | Envoy Gateway (Kubernetes Gateway API) | JWT validation, rate limits, TLS 1.3 |
| East-west | Linkerd mTLS, default-deny NetworkPolicy, workload identities | Only the exchange service may call the commercial service |
| Bridge | Exchange service mints an ephemeral, signed Dietary Profile Token (DPT) | The only path from clinical to commercial |
| Audit | Hash-chained ledger, single writer, signed checkpoints anchored in Object-Lock storage | Tampering is detectable even by a database admin |
| Residency | PHI-bearing components on Kenyan sovereign hosting, per the migration plan | Data Protection Act posture; confirm with counsel |

### 0.2 How “commerce” maps onto the shipped product

The shipped product is a checkout overlay on third-party retailers (Naivas, Carrefour Kenya, Quickmart Kenya), not a first-party shop. This blueprint maps the brief’s commercial entities onto that reality:

- `Commercial_Inventory` = the retailer catalogue and SKU-to-nutrition mappings (about 10.5k SKUs at v1.1.0).
- `Orders` = de-identified cart and checkout ledger events keyed by an ephemeral shopper alias.
- Fulfilment stays with the retailer.

If you later add a first-party storefront, the same schema and token flow apply unchanged.

### 0.3 Conflicts in the source documents — settle before coding

| # | Conflict | Where | Resolution adopted here |
| --- | --- | --- | --- |
| R1 | Rank inversion. The Report ranks `compliance_auditor` at 85 and the Inventory diagram puts it at Level 2, both above `tenant_admin`. Yet the SOP has tenant admins provisioning auditors, which fails `callerRank > targetRank` | Report §3.1, Inventory §3.1 vs SOP §2.1, §3 | Replace the linear rank test with an explicit **grant matrix** (`iam.role_grants`). Ranks become display-only. Roles are not a total order: an auditor is lateral and read-only |
| R2 | `commercial_stakeholder` rank is 40 in the SOP, 30 in the Report | SOP §2.1 vs Report §3.1 | Moot under R1 |
| R3 | `banned_until` is `3000-01-01` in the SOP and Inventory C-4, `2099-01-01` in the Report’s shipped migration | SOP §5.2 vs Report §3.2, §5 | Use `2099-01-01` (what shipped), define it once as a constant, update SOP §5.2 |
| R4 | Brief: dietician writes granular dietary tags. SOP: dietician is read-only | Brief vs SOP §2.1 | Dietician gets write on `clinical.dietary_tags` only (controlled vocabulary) and read on published advice. Nothing else |
| R5 | Auditor scope: brief says global or tenant, SOP says clinic only, Inventory describes DHA/ODPC regulators | Brief vs SOP vs Inventory | `auditor_scope` claim is `tenant` or `platform`. Platform auditors see ledger metadata only; decrypting payloads needs tenant DPO approval |
| R6 | The SOP stores `before_snapshot` and `after_snapshot` in the immutable ledger. That puts PHI in a store that cannot be erased and that platform-level readers can query | SOP §4.1 | The ledger carries a **hash commitment plus a payload encrypted under a per-tenant key** (crypto-shredding). See Phase 4 |
| R7 | No joiner path for `commercial_stakeholder`, and the `tenant_admin` row does not list it | SOP §2.1, §3 | `tenant_admin` provisions it, tenant-scoped, with its own audit action. **Needs your confirmation** |
| R8 | SOP cites “Health Act s.74, 20-year retention”. I could not verify that citation | SOP §5.2 | Retention becomes a **per-tenant policy row** with legal-hold support, not a hard-coded number. Have counsel set the default |
| R9 | The brief’s example tag `diabetic_friendly` reveals the diagnosis by inference | Brief, Phase 3 | The DPT carries nutrient bounds only, never condition-named tags. See Phase 3 |

### 0.4 Legal footing (design input, not legal advice)

- Anchor on the **Data Protection Act 2019** and its 2021 regulations. Health data is sensitive personal data, so design for recorded lawful basis and consent, minimisation, DPIA, data protection by design and default, 72-hour breach notification, and conditions on cross-border transfer.
- The **Digital Health Act 2023** was declared unconstitutional by the High Court on 12 July 2024 (Petition E473 of 2023). The Court of Appeal stayed that decision, and mid-2026 reporting still describes the Act as in force pending the appeal. Its 2025 regulations (Health Information Management Procedures; Data Exchange Component) have been gazetted.
- Load Digital Health Act rules as a **conformance profile in configuration** (retention, consent, sharing), not as hard-coded logic. The appeal outcome then changes a config row, not the architecture.
- Counsel to confirm: retention defaults, and the lawful basis for sharing a DPT with the commercial zone.

## Phase 1 — IAM and multi-tenant foundation

### 1.1 Tenancy: shared database, discriminator column, forced RLS

Applied inside each cluster (clinical, commercial, exchange, audit — see Phase 2). Network and tokens are the wall between zones; RLS is the wall between tenants inside a zone.

| Model | Isolation | Operating cost | Verdict |
| --- | --- | --- | --- |
| Schema-per-tenant | Medium (`search_path` mistakes, migrations × N) | High at hundreds of clinics | Reject |
| Database-per-tenant | Highest | Highest | Silo tier for large hospitals only |
| Shared tables + `tenant_id` + RLS | Strong when enforced in the database | Lowest | **Adopt** |

**Rules for every tenant-scoped table**

1. `tenant_id uuid NOT NULL`. Never nullable, never taken from client input.
2. Unique `(tenant_id, id)` and composite foreign keys `(tenant_id, parent_id)`, so a row cannot reference another tenant’s row.
3. `tenant_id` leads every index.
4. `ENABLE` and `FORCE ROW LEVEL SECURITY`, so the table owner is bound too.
5. Services connect as non-owner `NOBYPASSRLS` login roles. Migrations run as a `migrator` role no service can use.
6. One **RESTRICTIVE** `tenant_wall` policy per table, AND-ed with the permissive role policies.

```sql
-- One login role per service; none owns tables; none has BYPASSRLS
CREATE ROLE migrator NOLOGIN;
CREATE ROLE svc_clinical     LOGIN NOBYPASSRLS;
CREATE ROLE svc_provisioning LOGIN NOBYPASSRLS;
CREATE ROLE svc_exchange     LOGIN NOBYPASSRLS;
REVOKE ALL ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA app_private AUTHORIZATION migrator;

-- Claims come from the already-verified JWT, injected per transaction
CREATE FUNCTION app_private.claims() RETURNS jsonb LANGUAGE sql STABLE AS
$$ SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;

CREATE FUNCTION app_private.tenant_id() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (app_private.claims() ->> 'tenant_id')::uuid $$;

CREATE FUNCTION app_private.app_role() RETURNS text LANGUAGE sql STABLE AS
$$ SELECT app_private.claims() ->> 'role' $$;

CREATE FUNCTION app_private.uid() RETURNS uuid LANGUAGE sql STABLE AS
$$ SELECT (app_private.claims() ->> 'sub')::uuid $$;

-- The wall, applied to every tenant-scoped table
ALTER TABLE clinical.clinical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE clinical.clinical_records FORCE  ROW LEVEL SECURITY;

CREATE POLICY tenant_wall ON clinical.clinical_records
  AS RESTRICTIVE FOR ALL
  USING      (tenant_id = (SELECT app_private.tenant_id()))
  WITH CHECK (tenant_id = (SELECT app_private.tenant_id()));
```

Three properties to keep:

- **Fails closed.** A missing or malformed claim gives `NULL`, the comparison is never true, and no rows come back.
- **Wrapped in `(SELECT …)`.** The planner evaluates the claim once per statement instead of once per row.
- **No policy for `super_admin` on `clinical.*`.** Zero PHI visibility is the default state, not a rule someone has to remember.

**Prisma middleware: set claims per transaction**

```ts
import { PrismaClient } from '@prisma/client';

const base = new PrismaClient(); // connects as svc_clinical; never export this

export function forCaller(c: { sub: string; tenant_id: string; role: string }) {
  const claims = JSON.stringify(c);
  return base.$extends({
    query: {
      $allModels: {
        async $allOperations({ args, query }) {
          // set_config(..., true) is transaction-local, so it is safe behind PgBouncer
          const [, result] = await base.$transaction([
            base.$executeRaw`SELECT set_config('request.jwt.claims', ${claims}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    },
  });
}
```

- Handlers receive only the object `forCaller(verifiedClaims)` returns. Add an ESLint rule banning direct imports of the base client.
- Use interactive `$transaction(async tx => …)` for multi-statement work, with the same `set_config` call first.
- Never use session-level `SET` under transaction pooling.

**CI gate for the wall.** Extend `npm run check:rls` (today it verifies 16 tables) so the build fails if this returns any row:

```sql
SELECT c.oid::regclass AS table_without_wall
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname IN ('clinical','commercial','exchange','audit','iam') AND c.relkind = 'r'
  AND EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = c.oid AND a.attname = 'tenant_id' AND NOT a.attisdropped)
  AND ( NOT c.relrowsecurity OR NOT c.relforcerowsecurity
        OR NOT EXISTS (SELECT 1 FROM pg_policy p
                       WHERE p.polrelid = c.oid AND p.polname = 'tenant_wall' AND NOT p.polpermissive) );
```

Then add pgTAP canary tests: seed two tenants, run every role against every table, assert zero cross-tenant `SELECT`, `INSERT`, `UPDATE` and `DELETE`.

### 1.2 Authentication engine: Keycloak (OIDC)

**Configuration steps**

1. One realm, `nutriscore`. SSL required for external requests. Brute-force detection on. Breached-password denylist and a 12-character minimum (the SOP’s 16-character temporary password is generated server-side).
2. Self-registration off, all social identity providers off, generic error messages on login and recovery (SOP §6).
3. User-profile attribute `tenant_id`, writable only through the Admin API. **`iam.members` stays the source of truth;** Keycloak attributes are a projection written only by `provisioning-svc`.
4. Seven realm roles, one per persona. Keycloak does not enforce “exactly one role”, so `provisioning-svc` does.
5. Client scope `ns-core` carrying only the mappers in the claims table below. Remove the default `profile`, `email`, `roles` and `web-origins` scopes from API-bound tokens. Use lightweight access tokens.
6. Default signing algorithm ES256. Access token 5 minutes. Staff SSO idle 30 minutes, max 8 hours. Patient refresh tokens rotate with reuse detection (`revokeRefreshToken=true`, `refreshTokenMaxReuse=0`). Offline tokens disabled.
7. MFA required for every staff role (WebAuthn preferred, TOTP fallback). Step-up (`acr` ≥ 2) for publishing target bundles, role changes and break-glass.
8. An event-listener SPI streams `LOGIN`, `LOGIN_ERROR`, `LOGOUT`, `REFRESH_TOKEN_ERROR` and every admin event to `audit-svc`.
9. On suspend or deactivate, `provisioning-svc` disables the user, calls session logout, and pushes `sid` and `sub` to a Redis denylist. This is the Keycloak equivalent of the SOP’s purge of `auth.sessions` and `auth.refresh_tokens`.

**Clients**

| Client | Type | Flow | Audience |
| --- | --- | --- | --- |
| `cad-web` | Public | Authorization Code + PKCE (S256) | `ns-clinical-api` |
| `shopper-ext` | Public | Authorization Code + PKCE (S256) | `ns-clinical-api`, `ns-exchange-api` |
| `svc-clinical`, `svc-exchange`, `svc-audit`, `svc-provisioning` | Confidential, service account | `client_credentials` with `private_key_jwt` | Peer service audience |

- The extension runs the code flow through a first-party callback page that hands the code back via `externally_connectable` messaging. The manifest stays free of the `identity` permission you just removed.
- Implicit and password grants are disabled everywhere.

**Claims contract.** Identical to the shipped hook, so nothing downstream changes.

| Claim | Type | Source of truth | Notes |
| --- | --- | --- | --- |
| `iss`, `aud`, `exp`, `iat`, `jti` | standard | Keycloak | `aud` is per API. A token minted for one API is rejected by the others |
| `sub` | uuid | `iam.members.user_id` | Opaque. Never an email, phone or national ID |
| `sid` | uuid | Keycloak session | Revocation handle |
| `tenant_id` | uuid | `iam.members.tenant_id` | Absent for platform roles |
| `role` | enum | `iam.members.role` | Exactly one of the seven |
| `lic_ok` | bool | `iam.members.licence_verified` | Hint only. Writes re-check the database (1.3) |
| `auditor_scope` | `tenant` or `platform` | `iam.members.auditor_scope` | Present only for `compliance_auditor` |
| `acr`, `amr` | string | Keycloak | Drives step-up |
| `ver` | int | Realm config | Claim-schema version for safe rollout |

**Never in any token:** email, name, phone, MRN or national ID, diagnosis, health mode, clinician or patient lists, tenant display name.

```json
{
  "iss": "https://id.nutriscore.co.ke/realms/nutriscore",
  "aud": "ns-clinical-api",
  "sub": "7c1e9a52-3f0b-4e0e-9a54-0b4b7f2d6c11",
  "sid": "b1f04c7e-6d2a-45d1-8f0e-2a91c3d7e5aa",
  "tenant_id": "2f6d3c5a-9b1e-4c77-a0d4-5e8f1b2c3d44",
  "role": "writing_clinician",
  "lic_ok": true,
  "acr": "2",
  "amr": ["pwd", "otp"],
  "ver": 1,
  "iat": 1793460000,
  "exp": 1793460300,
  "jti": "e3a9b0c2-71d4-4f6a-9c18-6b5d2f0a8e17"
}
```

**Verification rules for every resource server**

1. Verify the signature against the cached JWKS (refresh on unknown `kid`). Algorithm allowlist is ES256 only; reject `none`.
2. Check `iss`, then `aud` equals this service’s own audience, then `exp` and `nbf` with 30 seconds of skew.
3. Staff APIs require `tenant_id` and `role`. Reject if either is missing.
4. Check `sid` and `sub` against the denylist.
5. Never trust gateway-injected headers for authorisation. Services re-verify the JWT themselves, so a spoofed `x-ns-*` header is worthless.

### 1.3 RBAC + ABAC engine

The same rules are enforced at three points: **gateway** (coarse route-to-role check), **service policy library** (full decision), **database RLS** (last line for reads and writes).

**Provisioning authority.** This replaces the numeric rank test (R1). Each row says who may create whom, and within what scope.

```sql
CREATE TABLE iam.role_grants (
  grantor_role text NOT NULL,
  grantee_role text NOT NULL,
  scope        text NOT NULL CHECK (scope IN ('platform','tenant','own_patients')),
  PRIMARY KEY (grantor_role, grantee_role, scope)
);

INSERT INTO iam.role_grants VALUES
  ('super_admin',       'tenant_admin',           'platform'),
  ('super_admin',       'compliance_auditor',     'platform'),
  ('tenant_admin',      'writing_clinician',      'tenant'),
  ('tenant_admin',      'viewing_dietician',      'tenant'),
  ('tenant_admin',      'compliance_auditor',     'tenant'),
  ('tenant_admin',      'commercial_stakeholder', 'tenant'),   -- R7, pending confirmation
  ('tenant_admin',      'patient',                'tenant'),
  ('writing_clinician', 'patient',                'own_patients');
-- super_admin -> super_admin is deliberately absent: bootstrap script only (SOP 2.2)
```

`provisioning-svc` allows a request only if `(caller.role, target.role, scope)` is a row here, the target `tenant_id` equals the caller’s (unless scope is `platform`), and a patient target carries both `tenant_id` and `primary_clinician_id`.

**RBAC permission matrix.** C = create, R = read, U = update, — = no access.

| Resource (class) | super\_admin | tenant\_admin | writing\_clinician | viewing\_dietician | compliance\_auditor | commercial\_stakeholder | patient |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Tenants, platform metrics (ADMIN) | CRU, metrics R | — | — | — | — | — | — |
| Accounts and lifecycle (ADMIN) | Provision `tenant_admin`, platform auditor | Provision per grant matrix; suspend, deactivate, verify licences | Provision own patients | — | — | — | Own profile RU |
| Patient directory: reference, status, primary clinician (ADMIN) | — | R | R (own patients) | R (referred) | — | — | Self |
| Clinical records, diagnosis text (PHI-1) | — | — | CRU on related patients; versioned, no delete | — | — | — | — |
| Clinical advice (PHI-1) | — | — | CRU | R (referred) | — | — | R (own, published) |
| Dietary tags | — | — | R | CRU (referred) | — | — | R (own) |
| Health modes, target bundles | R (platform templates) | — | CRU and publish (needs `lic_ok`) | R | — | — | R (own, via bundle) |
| Consent register | — | R (counts) | R (own patients) | — | R | — | RU (own; revoke) |
| Audit ledger | — | — | — | — | R (scope per claim) | — | — |
| Catalogue, SKU mappings, inventory (COMMERCIAL) | — | — | — | — | — | CRU | R (via DPT filter) |
| Orders, de-identified (COMMERCIAL) | — | — | — | — | — | R | CR (own, via alias) |
| Aggregates, k ≥ 5 (COMMERCIAL) | R (platform) | R | — | — | R | R | — |

**Role composition, not a hierarchy.** Only one real inheritance exists: a `base_staff` set (own profile, session management, notification preferences) that all six staff roles share. Everything else is explicit. A linear chain would leak: the Inventory diagram nests `commercial_stakeholder` under `viewing_dietician`, and any inherit-down or inherit-up reading hands clinical reads to commercial users or the reverse.

**ABAC attributes**

| Group | Attributes | Source |
| --- | --- | --- |
| Subject | `role`, `tenant_id`, member `status`, `licence_verified`, `auditor_scope`, `acr` | JWT for identity; `iam.members` re-read for status and licence |
| Resource | classification (`PHI1`, `PHI2`, `ADMIN`, `COMMERCIAL`, `AUDIT`), `tenant_id`, `patient_id`, `author_id` | Row metadata |
| Relationship | Active treatment relationship: kind, `can_write`, validity window | `clinical.treatment_relationships` |
| Context | Time, consent for the purpose, break-glass grant, caller zone | DB and request |

**Decision algorithm.** Ordered, first deny wins. Callers see a generic 403; the specific reason goes to the audit ledger only.

```ts
export async function decide(s: Subject, action: Action, r: Resource, now: Date): Promise<Decision> {
  const obligations: Obligation[] = [audit(r, action)];   // every PHI decision is audited

  if (await denylist.has(s.sid) || (await members.status(s.sub)) !== 'active')
    return deny('ACCOUNT_INACTIVE');

  const platformMeta = s.role === 'compliance_auditor' && s.auditorScope === 'platform'
                    && r.class === 'AUDIT_META';
  if (r.tenantId !== s.tenantId && !platformMeta) return deny('TENANT_MISMATCH');

  if (!PERMISSIONS[s.role].has(`${r.type}:${action}`)) return deny('RBAC');
  if (!CLEARANCE[s.role].has(r.class))                 return deny('CLASSIFICATION');

  if (r.patientId && CLINICAL_STAFF.has(s.role)) {
    const rel = await relationships.active(s.tenantId, s.sub, r.patientId, now);
    const bg  = rel ? null : await emergency.valid(s.tenantId, s.sub, r.patientId, now);
    if (!rel && !bg)             return deny('NO_RELATIONSHIP');
    if (bg && action !== 'read') return deny('BREAK_GLASS_READ_ONLY');
    if (isWrite(action) && !(rel?.canWrite && await members.licenceVerified(s.sub)))
      return deny('LICENCE_OR_RELATIONSHIP');
    if (bg) obligations.push(notifyDpo(), notifyAuditor(), flag('break_glass'));
  }

  if (r.requiresConsent && !(await consent.active(r.patientId, r.requiresConsent)))
    return deny('NO_CONSENT');

  if (STEP_UP.has(`${r.type}:${action}`) && s.acr < 2) return deny('STEP_UP_REQUIRED');
  return allow(obligations);
}
```

**The relationship record and its RLS mirror**

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE clinical.treatment_relationships (
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  staff_id   uuid NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('primary','covering','referral')),
  can_write  boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz,                         -- NULL = open-ended
  created_by uuid NOT NULL,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, staff_id)   REFERENCES iam.members (tenant_id, user_id),
  CHECK (kind <> 'primary' OR can_write),
  -- exactly one primary clinician per patient at any moment
  EXCLUDE USING gist (tenant_id WITH =, patient_id WITH =,
                      tstzrange(valid_from, valid_to) WITH &&) WHERE (kind = 'primary')
);

CREATE FUNCTION app_private.has_relationship(p_patient uuid, p_write boolean DEFAULT false)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1
    FROM clinical.treatment_relationships r
    JOIN iam.members m ON m.tenant_id = r.tenant_id AND m.user_id = r.staff_id
    WHERE r.tenant_id  = app_private.tenant_id()
      AND r.staff_id   = app_private.uid()
      AND r.patient_id = p_patient
      AND r.valid_from <= now() AND (r.valid_to IS NULL OR r.valid_to > now())
      AND m.status = 'active'
      AND (NOT p_write OR (r.can_write AND m.licence_verified))
  )
$$;

-- Writing clinician: read and insert only on related patients; no UPDATE or DELETE policy exists,
-- so clinical_records is append-only and corrections are new versions
CREATE POLICY clinician_select ON clinical.clinical_records FOR SELECT
  USING (app_private.app_role() = 'writing_clinician'
         AND (SELECT app_private.has_relationship(patient_id)));

CREATE POLICY clinician_insert ON clinical.clinical_records FOR INSERT
  WITH CHECK (app_private.app_role() = 'writing_clinician'
              AND author_id = (SELECT app_private.uid())
              AND (SELECT app_private.has_relationship(patient_id, true)));

-- Break-glass: read-only, time-boxed, per patient
CREATE POLICY break_glass_select ON clinical.clinical_records FOR SELECT
  USING (EXISTS (SELECT 1 FROM clinical.emergency_grants g
                 WHERE g.tenant_id  = clinical_records.tenant_id
                   AND g.patient_id = clinical_records.patient_id
                   AND g.grantee_id = (SELECT app_private.uid())
                   AND g.revoked_at IS NULL AND g.starts_at <= now() AND g.expires_at > now()));

-- Patient: published advice about themselves only
CREATE POLICY patient_own_advice ON clinical.clinical_advice FOR SELECT
  USING (app_private.app_role() = 'patient' AND status = 'published'
         AND patient_id = (SELECT p.id FROM clinical.patients p
                           WHERE p.tenant_id = clinical_advice.tenant_id
                             AND p.user_id = (SELECT app_private.uid())));

-- Dietician: tags only, for referred patients, own authorship
CREATE POLICY dietician_tags ON clinical.dietary_tags FOR ALL
  USING (app_private.app_role() = 'viewing_dietician'
         AND (SELECT app_private.has_relationship(patient_id)))
  WITH CHECK (app_private.app_role() = 'viewing_dietician'
              AND author_id = (SELECT app_private.uid())
              AND (SELECT app_private.has_relationship(patient_id)));
```

**Why revocation bites immediately.** `has_relationship` re-reads `iam.members.status` and `licence_verified` on every query. A suspended clinician loses access on the next statement, not when the 5-minute token expires. This is the behaviour SOP §4.2 asks for (“ceases immediately”), without relying on token refresh.

**Index for it:** `CREATE INDEX ON clinical.treatment_relationships (tenant_id, staff_id, patient_id) WHERE valid_to IS NULL;`

## Phase 2 — Network topography and microservices

### 2.1 Zones and subnets

```
                         Internet
                            |
                  WAF / CDN, TLS 1.3 only
                            |
  PUBLIC   10.40.0.0/24     |
                 +----------v-----------+
                 |    Envoy Gateway     |   JWT check, rate limits, header hygiene
                 +---+--------+-------+-+
                     |        |       |
  CLINICAL           |   EXCHANGE      |       COMMERCIAL
  10.40.10.0/24      |   10.40.20.0/24 |       10.40.30.0/24
  +----------------+ |   +-----------+ |       +-----------------+
  | clinical-svc   | |   | exchange- | |       | commercial-svc  |
  | clinical-db    | |   | svc       | |       | commercial-db   |
  | (PHI)          | |   | exchange- | |       | (de-identified) |
  +-------+--------+ |   | db        | |       +--------^--------+
          |          |   +-----+-----+ |                |
          | semantic |         |       +----------------+  DPT presented by the client;
          | projection (logical replication,              gRPC notices from exchange-svc
          +------------> column-filtered) --+

  PLATFORM 10.40.40.0/24   Keycloak, provisioning-svc
  AUDIT    10.40.50.0/24   audit-svc, audit-db, Vault / HSM
  MGMT     10.40.60.0/24   just-in-time bastion, observability
```

- No route exists between the clinical and commercial zones, in either direction.
- The exchange zone is the only place the two worlds touch, and it holds no clinical text.
- Some Kenyan hosting providers may not offer VPC primitives. Express each subnet as a private VLAN or network plus host firewalls plus Kubernetes NetworkPolicy. The rules below do not change.

### 2.2 Flow matrix (deny by default)

| From | To | Port / protocol | Identity | Purpose |
| --- | --- | --- | --- | --- |
| Internet | Envoy Gateway | 443, TLS 1.3 | — | All public APIs |
| Envoy | clinical-svc | 8443, mTLS | Gateway workload ID | Staff and patient clinical APIs |
| Envoy | exchange-svc | 8443, mTLS | Gateway workload ID | Mint a DPT; alias lookups |
| Envoy | commercial-svc | 8443, mTLS | Gateway workload ID | Stakeholder APIs and storefront |
| clinical-svc | clinical-db | 5432, TLS | `svc_clinical` | PHI reads and writes |
| clinical-db | exchange-db | 5432, logical replication | Replication role | Semantic projection only |
| exchange-svc | exchange-db | 5432, TLS | `svc_exchange` | Alias map, projection reads |
| exchange-svc | Vault / HSM | 8200, mTLS | exchange-svc | Sign DPT, derive alias |
| exchange-svc | commercial-svc | 9443, gRPC mTLS | exchange-svc | Revocation and erase notices |
| commercial-svc | commercial-db | 5432, TLS | `svc_commercial` | Catalogue and orders |
| clinical-svc, exchange-svc, commercial-svc, provisioning-svc | audit-svc | 9443, gRPC mTLS | Own workload ID | Audit events |
| provisioning-svc | Keycloak Admin API | 8443, mTLS | provisioning-svc | Joiner, mover, leaver |
| Every service | Keycloak JWKS | 443 | — | Signing keys |

### 2.3 Default-deny and mesh authorisation

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: default-deny, namespace: commercial }
spec:
  podSelector: {}
  policyTypes: [Ingress, Egress]
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata: { name: commercial-svc-ingress, namespace: commercial }
spec:
  podSelector: { matchLabels: { app: commercial-svc } }
  policyTypes: [Ingress]
  ingress:
    - from:
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: edge } }
        - namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: exchange } }
      ports: [{ port: 8443 }, { port: 9443 }]
# add explicit egress allows for DNS, commercial-db and audit-svc only
---
apiVersion: policy.linkerd.io/v1beta3
kind: Server
metadata: { name: commercial-internal, namespace: commercial }
spec:
  podSelector: { matchLabels: { app: commercial-svc } }
  port: 9443
  proxyProtocol: gRPC
---
apiVersion: policy.linkerd.io/v1alpha1
kind: MeshTLSAuthentication
metadata: { name: exchange-only, namespace: commercial }
spec:
  identities: ['exchange-svc.exchange.serviceaccount.identity.linkerd.cluster.local']
---
apiVersion: policy.linkerd.io/v1alpha1
kind: AuthorizationPolicy
metadata: { name: internal-from-exchange, namespace: commercial }
spec:
  targetRef: { group: policy.linkerd.io, kind: Server, name: commercial-internal }
  requiredAuthenticationRefs:
    - { group: policy.linkerd.io, kind: MeshTLSAuthentication, name: exchange-only }
```

The NetworkPolicy blocks the packet; the mesh policy then proves *which workload* sent it. Both must pass.

### 2.3 (cont.) Egress rules by zone

- clinical zone egress: audit-svc, Keycloak, Vault, and nothing else.
- commercial zone egress: DNS, commercial-db, audit-svc, and an allowlist of retailer endpoints if catalogue sync needs them.
- No zone gets general internet egress. Patches arrive through an internal mirror.

### 2.4 Envoy Gateway configuration

```yaml
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata: { name: public, namespace: edge }
spec:
  gatewayClassName: eg
  listeners:
    - name: https
      port: 443
      protocol: HTTPS
      hostname: api.nutriscore.co.ke
      tls: { mode: Terminate, certificateRefs: [{ name: api-tls }] }
      allowedRoutes: { namespaces: { from: Selector, selector: { matchLabels: { ns-route: 'true' } } } }
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: ClientTrafficPolicy
metadata: { name: edge-hardening, namespace: edge }
spec:
  targetRefs: [{ group: gateway.networking.k8s.io, kind: Gateway, name: public }]
  tls: { minVersion: '1.3' }
  connection: { connectionLimit: { value: 5000 } }
  clientIPDetection: { xForwardedFor: { numTrustedHops: 1 } }
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: SecurityPolicy
metadata: { name: jwt-clinical, namespace: clinical }
spec:
  targetRefs: [{ group: gateway.networking.k8s.io, kind: HTTPRoute, name: clinical-api }]
  jwt:
    providers:
      - name: keycloak
        issuer: https://id.nutriscore.co.ke/realms/nutriscore
        audiences: [ns-clinical-api]
        remoteJWKS: { uri: https://id.nutriscore.co.ke/realms/nutriscore/protocol/openid-connect/certs }
        claimToHeaders:
          - { claim: tenant_id, header: x-ns-tenant }
          - { claim: sub,       header: x-ns-sub }
  authorization:
    defaultAction: Deny
    rules:
      - name: clinical-roles
        action: Allow
        principal:
          jwt:
            provider: keycloak
            claims:
              - { name: role, valueType: String, values: [writing_clinician, viewing_dietician, patient] }
---
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: BackendTrafficPolicy
metadata: { name: per-tenant-limit, namespace: clinical }
spec:
  targetRefs: [{ group: gateway.networking.k8s.io, kind: HTTPRoute, name: clinical-api }]
  rateLimit:
    type: Global
    global:
      rules:
        - clientSelectors: [{ headers: [{ name: x-ns-tenant, type: Distinct }] }]
          limit: { requests: 600, unit: Minute }
```

- `claimToHeaders` exists for rate-limit keys and access logs only. Services never authorise from those headers (verification rule 5 in 1.2).
- Confirm filter ordering in your Envoy Gateway version, so the JWT filter runs before the rate-limit filter that reads the claim headers.
- Add a separate, tighter bucket keyed on client IP for `/auth/**` and `/v1/admin/**`.

**Route table (coarse authorisation at the edge)**

| Host and path | Backend | Roles accepted at the gateway |
| --- | --- | --- |
| `api.` `/v1/clinical/**` | clinical-svc | `writing_clinician`, `viewing_dietician`, `patient` |
| `api.` `/v1/admin/**` | provisioning-svc | `super_admin`, `tenant_admin`, `writing_clinician` (patients only; the service enforces that) |
| `api.` `/v1/audit/**` | audit-svc | `compliance_auditor` |
| `api.` `/v1/exchange/**` | exchange-svc | `patient` |
| `api.` `/v1/commerce/**` | commercial-svc | `commercial_stakeholder` |
| `shop.` `/v1/shop/**` | commercial-svc | DPT only (Phase 3). Separate hostname, separate audience, no shared cookies with `api.` |

### 2.5 Service catalogue

| Service | Zone | Datastore | Owns | Must never |
| --- | --- | --- | --- | --- |
| `clinical-svc` | Clinical | clinical-db | Patients, relationships, records, advice, dietary tags, health modes, consent, break-glass | Call the commercial zone; serve PHI on a service credential alone |
| `provisioning-svc` | Platform | `iam` schema in clinical-db | Joiner, mover, leaver; grant matrix; Keycloak projection; replaces the `admin-provision-user` Edge Function | Take public calls; create a `super_admin` |
| `exchange-svc` | Exchange | exchange-db, Vault | DPT minting, alias derivation, cohort check, withdrawal fan-out | Read clinical records; log constraint values |
| `commercial-svc` | Commercial | commercial-db | Catalogue, SKU mappings, orders, k-anonymous aggregates | Hold a patient identifier or a diagnosis |
| `audit-svc` | Audit | audit-db, Object-Lock bucket | Single-writer ledger, checkpoints, proofs | Accept updates; be reachable from the commercial zone |
| Keycloak | Platform | Own database | Authentication, sessions | Store PHI |

### 2.6 Service communication: three channels, no others

The clinical and commercial services never exchange data directly. Data crosses the wall in exactly three ways.

**Channel 1: semantic projection (clinical to exchange).** Postgres logical replication with a column list and row filter (PostgreSQL 15+). Only the clinician-published, already-semantic constraint set leaves the clinical cluster.

```sql
-- clinical-db
CREATE PUBLICATION pub_semantic
  FOR TABLE clinical.published_profiles (tenant_id, profile_id, patient_id, bundle_version, constraints, published_at)
  WHERE (status = 'published');
```

`constraints` holds nutrient bounds only, with no condition name and no free text (enforced by a CHECK against the allowlist in Phase 3).

**Channel 2: the DPT (exchange to the patient’s client to commercial).** The commercial service verifies the token offline against the exchange JWKS, so it never calls back to clinical or exchange to validate it.

**Channel 3: notices (exchange to commercial, gRPC).** Alias-only and token-only payloads.

```proto
syntax = "proto3";
package ns.commercial.v1;

service InternalNotices {
  rpc RevokeToken(RevokeTokenRequest) returns (Ack);   // jti only
  rpc EraseAlias(EraseAliasRequest)   returns (Ack);   // alias only
}
message RevokeTokenRequest { string jti = 1; int64 exp = 2; }
message EraseAliasRequest  { bytes alias = 1; string reason_code = 2; }
message Ack { bool ok = 1; }

service Storefront {
  // Constraints come from the verified DPT, never from the request body
  rpc FilterCatalog(FilterRequest) returns (stream SkuView);
}
message FilterRequest { string category = 1; int32 page_size = 2; string page_token = 3; }
message SkuView { string sku_id = 1; string name = 2; string retailer = 3;
                  map<string, double> per_100g = 4; string nutri_grade = 5; }
```

### 2.7 Resilience and hygiene

1. Timeouts: 10 s at the gateway, 5 s per service call. Retry only idempotent reads, with a retry budget.
2. Circuit breaker on exchange-svc to Vault, with fail-closed behaviour: no signing, no token.
3. `Idempotency-Key` required on order POSTs, stored 24 hours.
4. Clinical request bodies are never logged. Commercial logs strip query strings. Traces carry IDs, not payloads.
5. Secrets live in Vault. The commercial zone holds no credential that works anywhere in the clinical zone.

## Phase 3 — Cryptographic anonymisation and token exchange

Goal: a patient moves from the clinical dashboard to the catalogue and the commercial zone learns what its filter needs, never why.

### 3.1 Threat model: how a diagnosis could leak into commerce

| # | Channel | Example | Control |
| --- | --- | --- | --- |
| 1 | Token contents | A claim that names a condition | Allowlisted nutrient-bound vocabulary, schema-validated on both sides |
| 2 | Vocabulary inference | `diabetic_friendly` (the brief’s own example) or `low_potassium` implies a diagnosis even without naming it | Condition-named labels banned. Condition-revealing dimensions stay on the device |
| 3 | Linkability | One shopper ID across sessions and orders | Random per-session alias for browsing; pairwise, rotating alias for orders |
| 4 | Small cohorts | A rare constraint set in a clinic with three patients | Cohort gate, k ≥ 5, with generalisation |
| 5 | Side channels | URLs, `Referer`, logs, timing, error text | Header-only delivery, `Referrer-Policy: no-referrer`, query-string stripping, uniform mint-failure timing |
| 6 | Token theft | Replay of a captured DPT | DPoP key binding, 15-minute lifetime, `jti` revocation |
| 7 | Insider access to commercial data | A DBA reads the orders table | No patient identifier exists there. The alias cannot be reversed without the Vault key |

### 3.2 Anonymisation strategy

The shipped extension already scores products on the device, using the clinician-signed target bundle. That makes a two-tier split possible:

- **Tier A, server, coarse.** The DPT lets the commercial service pre-filter the catalogue on common dietary dimensions.
- **Tier B, device, precise.** Full thresholds and condition-revealing dimensions never leave the extension.

**Constraint vocabulary (the allowlist)**

| Dimension key | In the DPT? | Reason |
| --- | --- | --- |
| `sugars_g_100g_max`, `carbs_g_100g_max`, `sodium_mg_100g_max`, `satfat_g_100g_max`, `energy_kcal_100g_max`, `fibre_g_100g_min` | Yes, **banded** | Common to many wellness goals, so a value says little about a diagnosis |
| `protein_g_100g_max`, `potassium_mg_100g_max`, `phosphorus_mg_100g_max` | **No — device only** | Strongly indicative of renal conditions |
| Condition name, ICD code, health-mode name, clinician name, free text | **Never** | Direct disclosure |

**Banding.** Round each bound *up* to the next allowed step (for example sugar ∈ {5, 10, 15, 22.5} g, sodium ∈ {120, 300, 600} mg per 100 g). The server filter then returns a superset; the device applies the exact threshold and shows the warning. The exact clinician number is never disclosed.

The brief’s literal example `["diabetic_friendly", "max_carbs_30g"]` becomes `{"carbs_g_100g_max": 30}` after banding, with no tag.

### 3.3 From clinical dashboard to catalogue

1. The patient is signed in to the clinical app (host `api.`, audience `ns-clinical-api`).
2. They choose “Shop with my plan”. The client generates an **ephemeral DPoP key pair** (non-extractable WebCrypto) for this shopping session.
3. The client calls the exchange endpoint (RFC 8693 shape):

```
POST /v1/exchange/token
grant_type=urn:ietf:params:oauth:grant-type:token-exchange
subject_token=<patient access token>
subject_token_type=urn:ietf:params:oauth:token-type:access_token
requested_token_type=urn:ns:token-type:dpt
audience=ns-commercial
```

4. `exchange-svc` runs the minting pipeline (3.4). Keycloak only validates the subject token; the exchange logic is ours because it must scrub, band and gate.
5. The DPT returns to the client and is held in memory only. Never `localStorage`, never a cookie.
6. The shop session uses a different host (`shop.`), a different audience and a DPoP proof on every call. The clinical session continues untouched and shares nothing with it.

### 3.4 Minting pipeline

1. **Verify the subject token.** Rules from 1.2, `aud` = `ns-exchange-api`, `role` = `patient`, member status `active`.
2. **Consent.** An active `dietary_profile_sharing` consent at the current policy version, not withdrawn.
3. **Load** the latest published profile from the replicated projection. If none exists, mint a browse-only token with empty constraints.
4. **Scrub.** Keep only allowlisted keys, drop device-only dimensions, band the values, reject anything non-numeric. An unknown key aborts the mint.
5. **Cohort gate.** Fingerprint the constraint set (SHA-256 of its canonical form) and count patients in the tenant with the same fingerprint. If fewer than 5, loosen bands step by step until a cohort of 5 or more exists; if none does, issue the generic healthy-eating profile. Record `generalised=true` in the audit event, never in the token.
6. **Alias.** Derive the shopper alias (3.5).
7. **Sign** with EdDSA via Vault transit. The key never leaves Vault; `kid` rotates every 90 days with overlap.
8. **Persist** `dpt:{jti}` in Redis with TTL = `exp` for revocation, and an encrypted `alias_map` row.
9. **Audit** a `DPT_MINTED` event: patient reference, `jti`, constraint fingerprint, `generalised`, consent version. No constraint values.
10. **Respond** with `token_type: DPoP`, `expires_in: 900`, `Cache-Control: no-store`.

```json
{
  "iss": "https://exchange.nutriscore.co.ke",
  "aud": "ns-commercial",
  "jti": "9d1c7f0a-3b52-4e6d-8a14-c0f7e2b95d31",
  "iat": 1793460000,
  "exp": 1793460900,
  "tnt": "t_5k2m9x",
  "shp": "qL3vT8wXz1RnB0cKf6YdJg",
  "cs": { "sugars_g_100g_max": 15, "carbs_g_100g_max": 30, "sodium_mg_100g_max": 600 },
  "pol": 4,
  "cnf": { "jkt": "0ZcOCORZNYy-DWpqq30jZyJGHTN0d2HglBV3uiguA4I" }
}
```

- There is **no** `sub`, `sid`, email or patient reference.
- `tnt` is an opaque routing alias, not the tenant UUID. A specialist clinic’s identity is itself a health signal.
- `cnf.jkt` binds the token to the client’s ephemeral key, so a stolen token is useless without it.

### 3.5 Shopper\_ID: ephemeral and pairwise

| Mode | Alias | Lifetime | Linkable by commercial? |
| --- | --- | --- | --- |
| Browse | 128-bit CSPRNG value per DPT | Dies with the token | No |
| Order | `HMAC-SHA256(K_epoch, patient_id ‖ 'order' ‖ epoch)`, truncated to 128 bits | One epoch (quarterly) | Within an epoch only |

- `K_epoch` is derived in Vault per tenant per epoch. Only `exchange-svc` can compute an alias; the commercial service stores it and cannot reverse it.
- For “my orders”, the client asks for one DPT per epoch alias it needs. Commercial cannot link them by content. Timing and IP remain a residual link, so add small random delays and keep egress IPs shared.
- **Erasure by crypto-shredding.** Delete the epoch key and the `alias_map` row: that epoch’s orders become unlinkable to a person without touching the retained transaction records.

### 3.6 Commercial-side verification

1. Verify the signature against the exchange JWKS; check `iss`, `aud`, `exp`; check `jti` is not in the revocation set.
2. Verify the DPoP proof: `htm`, `htu`, `iat` within 60 seconds, proof `jti` not replayed, thumbprint equals `cnf.jkt`.
3. Validate `cs` against the same allowlist schema and reject unknown keys.
4. Apply `cs` as filters on `commercial.skus` and stream `SkuView` rows.
5. Orders: `POST /v1/shop/orders` with `Idempotency-Key`, persisted with the alias only.
6. Never log the token. Log a hash of `jti`.

### 3.7 Proving nothing leaks

- **Schema lint in CI.** Fail if any commercial-db column name or type matches `patient_id`, `user_id`, `email`, `phone`, `condition`, `diagnosis`, `icd`.
- **Canary test.** Seed a canary patient whose diagnosis text is `Type 2 Diabetes` with ICD code `E11.9` and a unique marker string. Run the full flow, then scan the commercial-db dump, commercial logs, traces, Envoy access logs, every minted DPT and a packet capture of the commercial subnet. Any hit fails the build.
- **Contract tests.** Exchange and commercial each reject any `cs` key outside the allowlist.
- **Optional DLP filter** on commercial routes that flags ICD patterns and a medical-term list in requests and responses.

### 3.8 Failure modes

| Event | Behaviour |
| --- | --- |
| Vault unreachable | No mint. The client falls back to the unfiltered catalogue with on-device flags |
| Patient withdraws consent mid-session | Exchange sends `RevokeToken` for live `jti`s and `EraseAlias` for all epochs. Commercial rejects within seconds |
| Clinician publishes an updated bundle | Next mint reflects it. An existing DPT keeps its old coarse bands for at most 15 minutes |
| Cohort below k | Generalise or fall back to the generic profile. Never refuse in a way that reveals rarity |

## Phase 4 — Data engineering, schemas and compliance auditing

### 4.1 Physical layout and data classification

| Cluster | Schemas | Written by | Holds | Protection |
| --- | --- | --- | --- | --- |
| clinical-db | `iam`, `clinical` | clinical-svc, provisioning-svc | PHI, staff records, consent, relationships | Volume encryption plus field-level AES-256-GCM on PHI columns |
| exchange-db | `exchange` | exchange-svc | Semantic projection, alias map, cohort counts | Volume encryption plus field-level on the alias map |
| commercial-db | `commercial` | commercial-svc | Catalogue, SKU mappings, inventory, orders | Volume encryption |
| audit-db | `audit` | audit-svc | Ledger, checkpoints | Volume encryption plus field-level on payloads |

| Class | Examples | Who may read | Notes |
| --- | --- | --- | --- |
| PHI-1 | Diagnosis text, clinical notes, ICD codes, advice | Related clinicians; patient (published advice only) | Field-encrypted |
| PHI-2 | Patient name, phone, email, date of birth | Related staff; tenant admin sees the minimal directory view only | Field-encrypted, blind index for lookup |
| PSEUDONYMOUS | Exchange projection, alias map | exchange-svc only | Constraint sets and patient UUIDs, never a condition name |
| ADMIN | Staff profile, licence data | Tenant admin; self | Licence number encrypted |
| COMMERCIAL | Catalogue, orders by alias | Commercial stakeholder | No patient identifier can exist here |
| AUDIT | Ledger | Auditors by scope | Payload encrypted |

**Field-level encryption**

1. **Envelope.** A per-patient data key (AES-256-GCM) is wrapped by a per-tenant key held in Vault transit or an HSM. Stored value: version byte, key ID, 12-byte nonce, ciphertext, tag.
2. **Bind to the row.** Authenticated data = `tenant_id`, table, column and row ID, so a ciphertext copied to another row or tenant fails to decrypt.
3. **Blind index** for equality lookups: `HMAC-SHA256(K_idx_tenant, normalised value)` stored beside the ciphertext (for example `email_bidx`).
4. **Keyed commitments, never plain hashes.** A bare SHA-256 of `Type 2 Diabetes` can be guessed by dictionary. Every integrity digest in this design is an HMAC under a tenant key.
5. **Erasure.** Destroying a patient’s wrapped data key renders every copy unreadable, including backups, once retention allows.

### 4.2 Clinical schema (PHI)

Platform-level accounts (`super_admin`, platform auditors) have no tenant and live in a separate `iam.platform_members` table.

```sql
CREATE TABLE iam.tenants (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  status     text NOT NULL CHECK (status IN ('active','suspended','offboarded')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE iam.members (
  tenant_id            uuid NOT NULL REFERENCES iam.tenants(id),
  user_id              uuid NOT NULL,                      -- equals the Keycloak sub
  role                 text NOT NULL CHECK (role IN ('tenant_admin','writing_clinician','viewing_dietician',
                                                     'compliance_auditor','commercial_stakeholder','patient')),
  status               text NOT NULL CHECK (status IN ('invited','active','suspended','deactivated')),
  auditor_scope        text CHECK (auditor_scope IN ('tenant','platform')),
  licence_body         text CHECK (licence_body IN ('KMPDC','KNDI')),
  licence_no_enc       bytea,
  licence_expiry       date,
  licence_verified     boolean NOT NULL DEFAULT false,
  licence_verified_by  uuid,
  licence_verified_at  timestamptz,
  primary_clinician_id uuid,                               -- patients only
  suspended_at         timestamptz,
  deactivated_at       timestamptz,
  PRIMARY KEY (tenant_id, user_id),
  CHECK (role <> 'patient' OR primary_clinician_id IS NOT NULL)
);

CREATE TABLE clinical.patients (
  tenant_id        uuid NOT NULL,
  id               uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id          uuid,                                   -- patient login (Keycloak sub)
  full_name_enc    bytea NOT NULL,
  phone_enc        bytea,
  email_enc        bytea,
  email_bidx       bytea,
  dob_enc          bytea,
  restricted       boolean NOT NULL DEFAULT false,         -- processing restriction under a rights request
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, user_id),
  UNIQUE (tenant_id, email_bidx)
);

CREATE TABLE clinical.patient_keys (
  tenant_id     uuid NOT NULL,
  patient_id    uuid NOT NULL,
  key_version   int  NOT NULL,
  dek_wrapped   bytea NOT NULL,
  destroyed_at  timestamptz,
  PRIMARY KEY (tenant_id, patient_id, key_version)
);

CREATE TABLE clinical.clinical_records (               -- append-only versions
  tenant_id     uuid NOT NULL,
  id            uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id    uuid NOT NULL,
  author_id     uuid NOT NULL,
  record_type   text NOT NULL CHECK (record_type IN ('diagnosis','assessment','note','lab_summary')),
  version       int  NOT NULL DEFAULT 1,
  supersedes_id uuid,
  body_enc      bytea NOT NULL,                          -- diagnosis and free text (PHI-1)
  coded_enc     bytea,                                   -- ICD-10 / SNOMED codes
  body_mac      bytea NOT NULL,                          -- HMAC commitment, used by the audit ledger
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id)    REFERENCES clinical.patients (tenant_id, id),
  FOREIGN KEY (tenant_id, supersedes_id) REFERENCES clinical.clinical_records (tenant_id, id)
);

CREATE TABLE clinical.clinical_advice (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL,
  author_id      uuid NOT NULL,
  status         text NOT NULL CHECK (status IN ('draft','published','withdrawn')),
  body_enc       bytea NOT NULL,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  version        int NOT NULL DEFAULT 1,
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, patient_id) REFERENCES clinical.patients (tenant_id, id)
);

CREATE TABLE clinical.dietary_tags (                   -- dietician-owned, controlled vocabulary
  tenant_id  uuid NOT NULL,
  id         uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id uuid NOT NULL,
  author_id  uuid NOT NULL,
  tag        text NOT NULL REFERENCES clinical.tag_vocabulary (tag),
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to   timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE FUNCTION clinical.constraints_valid(c jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(c) = 'object'
     AND NOT EXISTS (SELECT 1 FROM jsonb_object_keys(c) k
                     WHERE k NOT IN ('sugars_g_100g_max','carbs_g_100g_max','sodium_mg_100g_max',
                                     'satfat_g_100g_max','energy_kcal_100g_max','fibre_g_100g_min'))
$$;

CREATE TABLE clinical.published_profiles (             -- the only table replicated to the exchange
  tenant_id      uuid NOT NULL,
  profile_id     uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL,
  bundle_version int  NOT NULL,
  status         text NOT NULL CHECK (status IN ('published','withdrawn')),
  constraints    jsonb NOT NULL CHECK (clinical.constraints_valid(constraints)),
  published_by   uuid NOT NULL,
  published_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, profile_id)
);

CREATE TABLE clinical.consent_records (
  tenant_id      uuid NOT NULL,
  id             uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id     uuid NOT NULL,
  purpose        text NOT NULL,                          -- e.g. dietary_profile_sharing
  policy_version int  NOT NULL,
  granted_at     timestamptz NOT NULL DEFAULT now(),
  withdrawn_at   timestamptz,
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE clinical.emergency_grants (
  tenant_id    uuid NOT NULL,
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  patient_id   uuid NOT NULL,
  grantee_id   uuid NOT NULL,
  granted_by   uuid NOT NULL,
  incident_no  text NOT NULL,
  reason_enc   bytea NOT NULL,
  starts_at    timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  review_state text NOT NULL DEFAULT 'pending' CHECK (review_state IN ('pending','reviewed','escalated')),
  PRIMARY KEY (tenant_id, id),
  CHECK (expires_at <= starts_at + interval '24 hours')
);

CREATE TABLE clinical.retention_policies (
  tenant_id    uuid NOT NULL,
  record_class text NOT NULL,                            -- clinical_record, advice, consent, …
  retain_years int  NOT NULL,
  legal_hold   boolean NOT NULL DEFAULT false,
  basis        text NOT NULL,                            -- the citation counsel signs off (R8)
  PRIMARY KEY (tenant_id, record_class)
);
```

Every table above also gets `FORCE ROW LEVEL SECURITY` and the `tenant_wall` policy from 1.1. `clinical_records` has no UPDATE or DELETE policy at all.

### 4.3 Commercial schema (de-identified)

`commercial.skus` is shared reference data, written by platform data curation and read-only to tenants. Everything a stakeholder edits or sees about a tenant carries `tenant_id` and the same RLS wall.

```sql
CREATE TABLE commercial.skus (
  sku_id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  retailer            text NOT NULL CHECK (retailer IN ('naivas','carrefour_ke','quickmart_ke')),
  retailer_product_id text NOT NULL,
  name                text NOT NULL,
  brand               text,
  category_kfct       text,
  nova                smallint CHECK (nova BETWEEN 1 AND 4),
  per_100g            jsonb NOT NULL,                    -- SugarsG, SodiumMG, … as in the product JSON
  review_state        text NOT NULL CHECK (review_state IN ('REJECTED','UNVERIFIED','ESTIMATED','VERIFIED','HIGH_CONFIDENCE')),
  active              boolean NOT NULL DEFAULT true,
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (retailer, retailer_product_id)
);

CREATE TABLE commercial.sku_mappings (
  tenant_id   uuid NOT NULL,
  id          uuid NOT NULL DEFAULT gen_random_uuid(),
  sku_id      uuid NOT NULL REFERENCES commercial.skus (sku_id),
  partner_sku text NOT NULL,
  tags        text[] NOT NULL DEFAULT '{}',              -- product-side tags only, e.g. low_sugar
  PRIMARY KEY (tenant_id, id)
);

CREATE TABLE commercial.inventory (
  tenant_id    uuid NOT NULL,
  sku_id       uuid NOT NULL REFERENCES commercial.skus (sku_id),
  partner_site text NOT NULL,
  on_hand      int  NOT NULL,
  price_kes    numeric(12,2) NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, sku_id, partner_site)
);

CREATE TABLE commercial.orders (
  tenant_id       uuid NOT NULL,
  id              uuid NOT NULL DEFAULT gen_random_uuid(),
  shopper_alias   bytea NOT NULL,                        -- pairwise, rotating; never a patient ID
  epoch           int   NOT NULL,
  retailer        text  NOT NULL,
  status          text  NOT NULL,
  total_kes       numeric(12,2),
  idempotency_key text  NOT NULL,
  placed_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE commercial.order_lines (
  tenant_id      uuid NOT NULL,
  order_id       uuid NOT NULL,
  line_no        int  NOT NULL,
  sku_id         uuid NOT NULL REFERENCES commercial.skus (sku_id),
  qty            int  NOT NULL CHECK (qty > 0),
  unit_price_kes numeric(12,2) NOT NULL,
  PRIMARY KEY (tenant_id, order_id, line_no),
  FOREIGN KEY (tenant_id, order_id) REFERENCES commercial.orders (tenant_id, id)
);

-- What a stakeholder sees: order tracking without the alias
CREATE VIEW commercial.v_orders_tracking WITH (security_invoker = true) AS
  SELECT tenant_id, id, retailer, status, total_kes, placed_at FROM commercial.orders;

-- Demand analytics: suppressed unless at least 5 distinct shoppers
CREATE VIEW commercial.v_sku_demand WITH (security_invoker = true) AS
  SELECT o.tenant_id, l.sku_id, date_trunc('week', o.placed_at) AS week,
         count(DISTINCT o.shopper_alias) AS shoppers, sum(l.qty) AS units
  FROM commercial.orders o
  JOIN commercial.order_lines l ON l.tenant_id = o.tenant_id AND l.order_id = o.id
  GROUP BY o.tenant_id, l.sku_id, date_trunc('week', o.placed_at)
  HAVING count(DISTINCT o.shopper_alias) >= 5;
```

Stakeholder endpoints read the two views. Only the shopper-facing path touches `orders` directly, always filtered by the alias in a verified DPT. For finer cuts, add complementary suppression (so subtraction cannot recover a hidden cell) or differential-privacy noise on the aggregates.

### 4.4 What the audit system records

| Category | Events | Producer |
| --- | --- | --- |
| Authentication | `LOGIN`, `LOGIN_ERROR`, `LOGOUT`, `STEP_UP`, `REFRESH_TOKEN_ERROR` | Keycloak event listener |
| Authorisation | `AUTHZ_ALLOW` (PHI classes), `AUTHZ_DENY` (all) | Service policy library |
| Data access | `READ_CLINICAL_RECORD`, `READ_ADVICE`, `EXPORT_PATIENT_DATA` | clinical-svc |
| Data change | New record version, `PUBLISH_BUNDLE`, tag changes | clinical-svc plus DB trigger |
| Identity lifecycle | `CREATE_USER`, `UPDATE_ROLE`, `VERIFY_CLINICIAN_LICENCE`, `MEMBER_STATUS_*`, `REASSIGN_PATIENT_CLINICIAN` | provisioning-svc (names as in the SOP) |
| Consent | `CONSENT_GRANTED`, `CONSENT_WITHDRAWN` | clinical-svc |
| Exchange | `DPT_MINTED`, `DPT_REVOKED`, `ALIAS_ERASED` | exchange-svc |
| Break-glass | `BREAK_GLASS_GRANTED`, `_USED`, `_EXPIRED`, `_REVIEWED` | clinical-svc and scheduler |
| Commercial | `ORDER_CREATED`, `SKU_MAPPING_CHANGED` | commercial-svc |
| Platform | `BOOTSTRAP_SUPER_ADMIN`, `TENANT_ONBOARDED`, `KEY_ROTATED` | Scripts, Vault |

- **Envelope fields:** `event_id`, `tenant_id`, `occurred_at`, actor (`id`, `role`, `acr`, `sid`), `action`, `decision` and reason code, resource type and ID, `patient_ref`, `purpose`, hashed client IP, `severity`.
- `patient_ref` is `HMAC(K_ref_tenant, patient_id)`, so an auditor can correlate events about one patient without learning who they are.
- **Database backstop.** `pgaudit` on the clinical schema ships to `audit-svc`, so a code path that forgets to log still leaves a trace.
- Events travel producer → durable queue (Redpanda or NATS JetStream) → `audit-svc`. Producers use an outbox so a business transaction and its audit event commit together.

### 4.5 The WORM ledger

**Design**

1. **Single writer.** `audit-svc` is the only role with `INSERT`. Nobody has `UPDATE`, `DELETE` or `TRUNCATE`.
2. **One chain per tenant, plus one platform chain.** Gapless `seq`, serialised by an advisory lock. Seq 0 is the genesis record; `BOOTSTRAP_SUPER_ADMIN` lands in the platform chain.
3. **Hash.** `row_hash = SHA-256(prev_hash ‖ chain_id ‖ seq ‖ JCS(envelope) ‖ payload_mac)`, with JCS meaning RFC 8785 canonical JSON. The chain covers the envelope and the payload’s MAC, never plaintext, so destroying a key cannot break verification (resolves R6).
4. **Signature.** `audit-svc` signs each `row_hash` with an Ed25519 key in Vault. Anyone with the public key can verify offline.
5. **Checkpoints and anchoring.** Every 1,000 events or 5 minutes per chain, build a Merkle root over the range, sign it with the previous checkpoint’s hash, and write it to an **Object-Lock bucket in compliance mode** at a second site, optionally with an RFC 3161 timestamp token. The database is the query layer; the bucket is the WORM layer. A DBA who rewrites the table cannot rewrite the anchors.

```sql
CREATE TABLE audit.ledger (
  chain_id      uuid        NOT NULL,                  -- tenant_id, or the platform sentinel UUID
  seq           bigint      NOT NULL,
  event_id      uuid        NOT NULL UNIQUE,
  occurred_at   timestamptz NOT NULL,
  actor_id      uuid,
  actor_role    text,
  action        text        NOT NULL,
  decision      text,
  resource_type text,
  resource_id   uuid,
  patient_ref   bytea,                                 -- HMAC pseudonym, not the patient UUID
  severity      smallint    NOT NULL DEFAULT 0,
  envelope      jsonb       NOT NULL,
  payload_enc   bytea,                                 -- before/after snapshots, encrypted (R6)
  payload_mac   bytea,                                 -- keyed commitment, not a plain hash
  prev_hash     bytea       NOT NULL,
  row_hash      bytea       NOT NULL,
  signature     bytea       NOT NULL,
  PRIMARY KEY (chain_id, seq)
);

CREATE TABLE audit.checkpoints (
  chain_id             uuid NOT NULL,
  seq_from             bigint NOT NULL,
  seq_to               bigint NOT NULL,
  merkle_root          bytea NOT NULL,
  prev_checkpoint_hash bytea NOT NULL,
  signature            bytea NOT NULL,
  anchor_uri           text  NOT NULL,
  anchored_at          timestamptz NOT NULL,
  PRIMARY KEY (chain_id, seq_to)
);

REVOKE ALL ON audit.ledger, audit.checkpoints FROM PUBLIC;
GRANT INSERT ON audit.ledger, audit.checkpoints TO svc_audit_writer;

CREATE FUNCTION audit.deny_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit ledger is append-only (%)', TG_OP USING ERRCODE = '42501';
END $$;

CREATE TRIGGER trg_audit_log_tamper BEFORE UPDATE OR DELETE ON audit.ledger
  FOR EACH ROW EXECUTE FUNCTION audit.deny_mutation();
CREATE TRIGGER trg_audit_log_truncate BEFORE TRUNCATE ON audit.ledger
  FOR EACH STATEMENT EXECUTE FUNCTION audit.deny_mutation();

ALTER TABLE audit.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.ledger FORCE  ROW LEVEL SECURITY;

-- Tenant auditors: their own chain, all columns
CREATE POLICY tenant_auditor ON audit.ledger FOR SELECT
  USING (app_private.app_role() = 'compliance_auditor'
         AND app_private.claims() ->> 'auditor_scope' = 'tenant'
         AND chain_id = (SELECT app_private.tenant_id()));
GRANT SELECT ON audit.ledger, audit.checkpoints TO svc_audit_reader_tenant;

-- Platform auditors: a metadata-only view, nothing on the base table
CREATE VIEW audit.v_ledger_platform AS
  SELECT chain_id, seq, event_id, occurred_at, actor_role, action, decision,
         resource_type, severity, row_hash, signature
  FROM audit.ledger;
ALTER VIEW audit.v_ledger_platform OWNER TO audit_view_owner;
GRANT SELECT ON audit.ledger TO audit_view_owner;
CREATE POLICY platform_meta_view ON audit.ledger FOR SELECT TO audit_view_owner USING (true);
GRANT SELECT ON audit.v_ledger_platform TO svc_audit_reader_platform;
```

If a platform auditor ever needs the content of one event, a two-person approval workflow (tenant DPO plus the auditor) issues a time-boxed decrypt grant, itself logged as `AUDIT_PAYLOAD_DECRYPTED`.

**The writer**

```ts
await db.tx(async (tx) => {
  await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [chainId]);

  const last = await tx.oneOrNone(
    'SELECT seq, row_hash FROM audit.ledger WHERE chain_id = $1 ORDER BY seq DESC LIMIT 1', [chainId]);
  const seq  = last ? last.seq + 1n : 0n;
  const prev = last ? last.row_hash : genesisHash(chainId);

  const payloadMac = hmac(tenantKey(chainId, 'audit-mac'), payloadPlain);       // commitment, not a hash
  const rowHash   = sha256(concat(prev, uuidBytes(chainId), int64(seq), jcs(envelope), payloadMac));
  const signature = await vault.sign('audit-ed25519', rowHash);

  await tx.query(INSERT_LEDGER_SQL, [chainId, seq, /* envelope fields, payload_enc, payloadMac, */ prev, rowHash, signature]);
});
```

Throughput is bounded per chain, which is what you want: it serialises each tenant’s history. Batch several events per transaction when a chain gets hot.

**Verification**

1. `scripts/verify-audit-chain.mjs` (already in the SOP) is upgraded to recompute every `row_hash`, verify every signature, confirm `seq` is gapless, and compare each checkpoint with its anchored object.
2. It runs every 15 minutes and before every audit export. A mismatch raises a severity-1 incident and starts the 72-hour breach clock assessment.
3. Auditors get `GET /v1/audit/proofs?chain=&from=&to=`, which returns the rows plus Merkle inclusion proofs, and an offline verifier CLI that needs only the public keys.

### 4.6 Break-glass, retention and erasure

| Topic | Mechanism |
| --- | --- |
| Break-glass | Invoked by the clinic CMO or a senior tenant admin with `patientRef`, `emergencyReason` and `clinicalIncidentNumber`. Step-up auth required. Read-only, scoped to one patient, `expires_at` at most 24 hours (CHECK constraint). Writes `BREAK_GLASS_GRANTED` at high severity and notifies the DPO and a compliance auditor. A scheduler closes it. Every grant must reach `reviewed` within an agreed window or it escalates |
| Retention | `clinical.retention_policies` per tenant and record class. No `DELETE` policy exists on clinical tables, and a purge job runs only after retention has elapsed and `legal_hold` is false |
| Erasure request inside retention | Set `restricted = true` (processing restriction) and explain the retention basis to the patient. Nothing is destroyed |
| Erasure after retention | Crypto-shred: destroy the patient’s data key and the alias-map rows. Structural rows (IDs, timestamps) remain so references and the audit chain stay intact |
| Rectification | A new record version. The old version stays for medico-legal reasons |
| Subject access | An export job decrypts the patient’s data into a signed bundle, audited as `EXPORT_PATIENT_DATA` |
| Backups | Encrypted under the same keys, so key destruction covers them |

## 5. Implementation sequence, verification and open decisions

### 5.1 Build order, with an exit test per step

| Step | Build | Needs | Exit test |
| --- | --- | --- | --- |
| 1 | Clusters, DB roles, schemas, `app_private` helpers, `tenant_wall` on every tenant table, CI wall gate | — | Gate query returns zero rows; pgTAP cross-tenant suite green |
| 2 | Keycloak realm, clients, claims contract, MFA, denylist | 1 | A token for one API is rejected by another; an automated claim scan finds no email or name in any token; a denylisted `sid` is rejected |
| 3 | `provisioning-svc`, grant matrix, joiner-mover-leaver | 1, 2 | Tenant admin creating an auditor is allowed; clinician creating a clinician is denied; cross-tenant creation is denied; `super_admin` via API is denied; session purge completes in under 5 seconds |
| 4 | ABAC, relationships, licence gating, break-glass | 1–3 | Revoked clinician loses reads on the next query; unverified-licence clinician cannot publish a bundle; break-glass reads work for 24 hours then fail, and writes are always denied |
| 5 | `audit-svc`, ledger, checkpoints, anchoring, verifier | 1 | A DBA edit to a row makes the verifier fail; a deleted anchor is impossible (Object Lock); a `seq` gap is detected |
| 6 | Network zones, Envoy Gateway, mesh policies | Parallel | A commercial pod cannot reach clinical-db; only the exchange identity reaches port 9443 |
| 7 | Clinical schema, field encryption, `published_profiles`, replication | 1, 4 | A ciphertext moved to another row fails to decrypt; destroying a patient key makes their records unreadable |
| 8 | `exchange-svc`, DPT, alias, cohort gate | 2, 6, 7 | Canary scan has zero hits; a replayed DPoP proof is rejected; the cohort gate generalises |
| 9 | Commercial schema, storefront, views | 6, 8 | Stakeholder cannot see an alias; demand view suppresses cells under 5 shoppers |
| 10 | Retention jobs, rights workflows, breach runbook, DPIA | All | DPIA signed off; one tabletop breach exercise completed |

### 5.2 Test matrix that must pass before launch

| Layer | Test | Expectation |
| --- | --- | --- |
| Tenancy | Two tenants, every role, every table, all four verbs | Zero cross-tenant rows read or written |
| RBAC | Table-driven test generated from the permission matrix in 1.3 (7 roles × 12 resources × create/read/update) | Result equals the matrix, no more and no less |
| ABAC | No relationship, expired relationship, unlicensed writer, suspended member | Each denied with the right reason code in the ledger |
| Tokens | Algorithm confusion, `alg=none`, wrong `aud`, expired, denylisted | All rejected |
| Exchange | Unknown constraint key, device-only dimension, cohort below 5, consent withdrawn | Abort, drop, generalise, revoke respectively |
| Leakage | Canary patient across the full flow | No marker in commercial data, logs, traces or captures |
| Audit | Tamper, reorder, delete, gap, key rotation | Verifier detects each; rotation does not break old rows |
| Break-glass | Use at hour 23, hour 25, with a write attempt | Allowed read, denied, denied |
| Offline | Extension with no network | Scores from the local bundle; no PHI requested |

### 5.3 Mapping to the shipped build

| Shipped | Blueprint component | Action |
| --- | --- | --- |
| `tenant_members`, `custom_access_token_hook` | `iam.members`, Keycloak protocol mappers | Keep the schema; add `auditor_scope` and `licence_body`; port the hook to mappers at cutover |
| `admin-provision-user` Edge Function | `provisioning-svc`, `iam.role_grants` | Replace the rank test with the grant matrix (R1); keep the SOP’s audit action names |
| `public.audit_log`, `trg_audit_log_tamper`, `verify-audit-chain.mjs` | `audit.ledger`, checkpoints | Add per-tenant chains, keyed payload commitment, signed checkpoints and Object-Lock anchoring. Migrate old rows with a documented cutover checkpoint |
| `health_modes`, `health_mode_rules`, `target_bundles` | Clinical schema, `published_profiles` | Compile the six-dimension coarse projection at publish time |
| `entitlement` function (ES256 JWT) | Patient session plus DPT | Retire premium semantics; DPT is issued by `exchange-svc` |
| `consents`, `consent_records` | `clinical.consent_records` | Add `purpose` and policy version; withdrawal events drive the exchange |
| Product JSON, catalogue sync | `commercial.skus` | Load through a platform curation job; `review_state` gating stays |
| On-device scoring in the extension | Tier B filtering | No change. It is what keeps device-only dimensions off the wire |
| `npm run check:rls` (16 tables) | CI wall gate | Replace with the catalogue query in 1.1 across all schemas |
| Supabase `auth.uid()` in policies | `app_private.uid()` | Same meaning; the helper functions are the only place the platform differs |

On your Supabase-to-Kenyan-cloud migration: the `app_private` claim helpers are the single seam between Supabase’s JWT handling and a Keycloak-issued claim set. Policies written against the helpers migrate untouched.

### 5.4 Kenyan compliance mapping (design input, for counsel to confirm)

| Obligation | Control here |
| --- | --- |
| Lawful basis and consent | `consent_records` with purpose and policy version; consent gate at first login; withdrawal drives DPT revocation |
| Purpose limitation and minimisation | Separate zones; DPT carries banded nutrient bounds only; device-only dimensions never leave the extension |
| Accuracy and rectification | Versioned records; old versions kept |
| Storage limitation | `retention_policies` with legal hold; crypto-shred after retention |
| Security safeguards | Field encryption, mTLS, MFA, RLS, WORM ledger |
| Data protection by design and default | Fail-closed claims, default-deny network, no policy means no access |
| Data-subject rights | Export job; `restricted` flag; shred workflow |
| High-risk processing assessment | DPIA required before step 10 exit |
| Breach notification, 72 hours | Verifier alerts, `AUTHZ_DENY` spike and break-glass anomaly alarms feed the incident runbook |
| Cross-border and residency | PHI components on Kenyan hosting; no PHI egress path |
| Processor arrangements | SLA plus Data Processing Addendum per tenant (SOP §3.2); controller and processor registration with the ODPC |
| Professional licensing | KMPDC and KNDI verification gate on `licence_verified` |
| Digital Health Act regulations | Conformance profile in configuration (0.4) |

### 5.5 Decisions I need from you

1. **R7.** Does `tenant_admin` provision `commercial_stakeholder`, or should `super_admin` approve each one?
2. **R1 and R3.** Confirm the grant matrix replaces rank, and that `2099-01-01` is the single ban constant.
3. **R5.** Do DHA or ODPC regulators need platform-scope auditor accounts, or only clinic-appointed auditors?
4. **Identity timing.** Stay on Supabase Auth until the sovereign-cloud cutover, or move to Keycloak first? The claim contract is identical, so both work.
5. **Counsel.** Retention default (R8), lawful basis for sharing a DPT, and the DPIA.
6. **Scope.** Overlay-only, or a first-party storefront on the roadmap?

Not covered here, because you scoped them separately: clinic subscription billing (Daraja and Paystack) and KHIE integration.
