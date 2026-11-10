# Standard Operating Procedure (SOP): CAD Identity Lifecycle & RBAC Provisioning

**Document ID:** SOP-CAD-SEC-001  
**Version:** 1.0  
**Effective Date:** October 2026  
**Regulatory Scope:** Kenya Data Protection Act (DPA 2019), Health Act (2017), KMPDC & KNDI Regulations, OWASP ASVS 4.0  
**Authority:** Clinic Admin Dashboard (CAD) Architecture Core  

---

## 1. Purpose and Objectives

Following the decommissioning of consumer self-registration and third-party social logins (Google OAuth), the **Clinic Admin Dashboard (CAD)** is established as the sole authority for identity creation, role delegation, access lifecycle, and clinical oversight.

This Standard Operating Procedure governs the complete **Joiner-Mover-Leaver (JML)** lifecycle for all platform personas:
1. **Platform Super Administrators** (`super_admin`)
2. **Clinic / Tenant Administrators** (`tenant_admin`)
3. **Writing Clinicians** (`writing_clinician`)
4. **Viewing Dieticians** (`viewing_dietician`)
5. **Compliance Auditors** (`compliance_auditor`)
6. **Commercial Stakeholders** (`commercial_stakeholder`)
7. **Patients / Shoppers** (`patient`)

Every action executed under this SOP must strictly adhere to the principles of **Least Privilege**, **Non-Repudiation**, and **Tamper-Evident Auditing**.

---

## 2. Role Authority & Provisioning Invariants

### 2.1 Grant Matrix

Provisioning is authorised only when the exact tuple
`(caller.app_role, target.app_role, scope)` exists in `iam.role_grants`.
Roles are not a hierarchy and no numeric rank may authorise an action.

| Caller | Target role | Scope | Additional invariant |
|---|---|---|---|
| `super_admin` | `tenant_admin` | `platform` | Chooses the target tenant. |
| `super_admin` | `compliance_auditor` | `platform` | DHA or ODPC only; a written `mandate_ref` is required. |
| `super_admin` | `commercial_stakeholder` | `platform` | Chooses exactly one tenant and supplies the partner legal entity (`partner_org`). |
| `tenant_admin` | `writing_clinician`, `viewing_dietician`, `compliance_auditor`, `patient` | `tenant` | Target tenant equals the caller tenant. Clinic auditors have `auditor_scope = 'tenant'`. |
| `writing_clinician` | `patient` | `own_patients` | Target has the caller as `primary_clinician_id`. |

`super_admin` is deliberately absent as a target: it is created only by the
bootstrap script. A tenant administrator may suspend, but may not create,
reactivate or role-change, a commercial stakeholder in the same tenant.

### 2.2 Core Provisioning Invariants

1. **No Self-Registration:** Public sign-up is hard-disabled in `config.toml` (`enable_signup = false`). Any anonymous invocation to auth endpoints returns an immediate error.
2. **Strict Clinic Scoping:** Non-super-admins cannot provision users outside their own `tenant_id`. Any request specifying a different `tenantId` is rejected with `403 Forbidden`.
3. **Mandatory Patient Linking:** Every patient account must be bound at creation to:
   - Exactly **one Clinic** (`tenant_id`).
   - Exactly **one Primary Writing Clinician** (`primary_clinician_id`).
4. **Platform Admin Local Bootstrap Only:** Platform `super_admin` accounts can never be created through API endpoints or edge functions. They must be initialized via the local bootstrap script `scripts/bootstrap-super-admin.mjs` against non-production environments and are stored in `iam.platform_members`, not a tenant membership.
5. **Commercial Stakeholder Boundary:** A commercial stakeholder has exactly one tenant membership. Creation, reactivation and any role change into or out of that role require a `super_admin`; `partner_org` is mandatory.
6. **Platform Auditor Boundary:** A platform-scoped auditor is stored in `iam.platform_members`, is limited by database check to `DHA` or `ODPC`, and may access audit metadata only. It has no clinical-table policy.

---

## 3. Joiner Lifecycle (Account Creation & Verification)

### 3.1 Platform Super Administrator (`super_admin`)
- **Authority:** Infrastructure & Platform Engineering Lead.
- **Mechanism:** Direct execution of `node scripts/bootstrap-super-admin.mjs`.
- **Pre-flight Checks:**
  - Verified local database instance or non-production staging.
  - Script aborts immediately if targeting production (`supabase.co`) without explicit safety overrides.
- **Audit Requirement:** The script records a `BOOTSTRAP_SUPER_ADMIN` event in the platform audit chain.

### 3.2 Clinic / Tenant Administrator (`tenant_admin`)
- **Authority:** Platform Super Administrator.
- **Verification:** Signed Institutional Service Level Agreement (SLA), Data Processing Addendum (DPA), and clinic registration with the Kenya Ministry of Health / KHPOA.
- **Workflow:**
  1. Super Admin navigates to CAD Tenant Management.
  2. Inputs official clinic email, institutional entity name, and administrator full name.
  3. Invokes Edge Function `admin-provision-user` (`role = 'tenant_admin'`).
  4. Secure initial credentials delivered to the institutional contact via encrypted channel.

### 3.3 Clinical Staff (`writing_clinician`, `viewing_dietician`)
- **Authority:** Clinic Tenant Administrator.
- **Professional Credential Verification (Mandatory Step):**
  - **For Doctors / Medical Practitioners:** Verify licence against the **Kenya Medical Practitioners and Dentists Council (KMPDC)** online register.
    - Record: Full Name, KMPDC Registration Number (e.g., `A-49201`), Expiry Date, and Specialisation.
  - **For Dieticians / Nutritionists:** Verify licence against the **Kenya Nutritionists and Dieticians Institute (KNDI)** register.
    - Record: Full Name, KNDI License Number (e.g., `NUT-10492`), Expiry Date.
- **Workflow:**
  1. Clinic Admin invokes `admin-provision-user` with `role = 'writing_clinician'` or `'viewing_dietician'`, supplying licence details.
  2. Member is created in `status = 'active'` or `'invited'`.
  3. **Licence Verification Action:** The Clinic Admin reviews physical/certified documentation and clicks **Verify Licence** in CAD `UserManagementView`.
  4. This triggers an explicit audit event: `VERIFY_CLINICIAN_LICENCE` recording the verifying Admin's ID and timestamp.
  5. *Invariant:* A writing clinician cannot publish dietary target bundles or link patients until `licence_verified = true`.

### 3.4 Patient / Shopper (`patient`)
- **Authority:** Licensed Writing Clinician or Clinic Tenant Administrator.
- **Prerequisites:** In-person or documented telehealth clinical consultation where dietary intervention is indicated.
- **Workflow:**
  1. Clinician enters patient email / identifier and selects the primary clinician.
  2. Invokes Edge Function `admin-provision-user` (`role = 'patient'`, `primaryClinicianId = <clinician_id>`).
  3. The service records the tenant membership and primary clinician; Auth metadata is not an authorization source.
  4. System generates a secure, high-entropy 16-character temporary password.
  5. Clinician delivers the clinic-issued credentials securely to the patient (printed care card or encrypted clinic message).
  6. **First Login Gate:** Patient opens the NutriScore extension, enters the clinic credentials, is immediately prompted to replace the temporary password, and must review and accept the Terms & Privacy Notice before any catalog sync or scoring begins.

### 3.5 Commercial Stakeholder (`commercial_stakeholder`)
- **Authority:** Platform Super Administrator only.
- **Workflow:** The Super Admin selects one tenant, records the commercial
  partner legal entity in `partner_org`, and invokes `admin-provision-user`.
  The service records `PROVISION_COMMERCIAL_STAKEHOLDER`; the approving
  administrator and partner organisation are captured in the audit event.
- **Restriction:** Tenant administrators cannot create, reactivate or
  role-change this account. They may suspend it only as a same-tenant leaver
  safeguard.

### 3.6 Platform Compliance Auditor (`compliance_auditor`, platform scope)
- **Authority:** Platform Super Administrator only.
- **Workflow:** The Super Admin selects either `DHA` or `ODPC`, supplies the
  regulator's written `mandate_ref`, and provisions the account into
  `iam.platform_members`. The service records `PROVISION_PLATFORM_AUDITOR`.
- **Restriction:** A platform auditor has no tenant membership and may read
  only cross-tenant audit metadata, checkpoints and inclusion proofs. Payload
  decryption requires the separate two-person approval workflow.

---

## 4. Mover Lifecycle (Role & Care Team Changes)

### 4.1 Role Changes
- An existing staff member transitioning between roles (e.g., resident dietician to licensed clinician):
  - Must be initiated by a caller allowed by `iam.role_grants` for the exact
    tenant and role transition.
  - Any transition into or out of `commercial_stakeholder` requires a
    `super_admin`; a transition into that role also requires `partner_org`.
  - **Mandatory Session Revocation:** Upon role change, all active sessions in `auth.sessions` and refresh tokens in `auth.refresh_tokens` are purged immediately to force token re-issuance with updated JWT claims.
  - An audit record `UPDATE_ROLE` is stored without plaintext profile or
    clinical snapshots.

### 4.2 Patient Care Team Re-assignment
- When a patient transitions to another primary clinician within the clinic:
  - Tenant Admin updates `primary_clinician_id` in `public.tenant_members` and `auth.users.app_metadata`.
  - Audit log captures `REASSIGN_PATIENT_CLINICIAN` with previous and new clinician IDs.
  - Previous clinician's RLS visibility to that patient's health diary and cart scans ceases immediately upon token refresh.

---

## 5. Leaver Lifecycle (Suspension & Deactivation)

### 5.1 Account State Machine

```
         ┌──────────────┐
         │   INVITED    │
         └──────┬───────┘
                │ First Login & Activation
                ▼
         ┌──────────────┐
   ┌────►│    ACTIVE    │◄────┐
   │     └──────┬───────┘     │ Re-activation
   │            │             │
   │            ▼             │
   │     ┌──────────────┐     │
   │     │  SUSPENDED   ├─────┘
   │     └──────┬───────┘
   │            │ Permanent Offboarding
   │            ▼
   │     ┌──────────────┐
   └─────┤ DEACTIVATED  │
         └──────────────┘
```

### 5.2 Deactivation Protocol (No Hard Deletes)
In compliance with clinical retention mandates (Kenya Health Act s.74, 20-year medical record retention), **patient and clinician records are never permanently deleted via SQL `DELETE`**. Accounts are soft-deactivated.

- **Trigger:** Staff termination, patient discharge, medical leave, or suspected account compromise.
- **Execution:**
  1. Authorized Admin invokes `deactivate_tenant_member` (or CAD User Management action).
  2. Member status is updated to `'suspended'` (temporary) or `'deactivated'` (permanent).
  3. `deactivated_at` or `suspended_at` timestamp recorded.
  4. **Global Session Purge:**
     ```sql
     DELETE FROM auth.refresh_tokens WHERE user_id = target_user_id;
     DELETE FROM auth.sessions WHERE user_id = target_user_id;
     UPDATE auth.users SET banned_until = '2099-01-01T00:00:00Z' WHERE id = target_user_id;
     ```
  5. The `custom_access_token_hook` refuses any subsequent token request. The
     shared denylist also rejects already-issued tokens immediately.
  6. Extension or client requests fail immediately with `401 / 403`, preventing any further target retrieval or catalog synchronization.
  7. Audit event `MEMBER_STATUS_DEACTIVATED` is committed to the append-only ledger.

---

## 6. Password Recovery & Anti-Enumeration

1. **Generic Error Responses:** Login endpoints and recovery dialogs must return generic messages (e.g., *"Invalid clinic credentials"* or *"If this account is registered with your clinic, recovery instructions have been sent"*).
2. **Emailed Recovery Links:** Password reset links are dispatched only to pre-existing, active email addresses in the auth system.
3. **Deactivated Account Handling:** If a deactivated or banned account attempts password recovery, the system quietly swallows the request without dispatching recovery links or revealing the account state.

---

## 7. Emergency Break-Glass Access Protocol

In acute patient safety situations (e.g., sudden anaphylaxis or ICU admission where the assigned primary clinician is unreachable):

1. **Who May Invoke:** Clinic Chief Medical Officer or verified Senior Tenant Administrator.
2. **Procedure:**
   - Invocation of emergency care delegation endpoint with mandatory input of:
     - `patientRef`
     - `emergencyReason`
     - `clinicalIncidentNumber`
3. **Automated Safeguards:**
   - Access is time-bounded (maximum 24 hours).
   - Generates an immutable `mutation_type = 'break_glass'` entry in `public.audit_log`.
   - Sends automated high-priority security notifications to the Compliance Auditor and the Data Protection Officer (DPO).
   - Automatically expires and revokes when the 24-hour window lapses.

---

## 8. Audit Trail Verification & Compliance Reporting

- Every lifecycle change is logged to `public.audit_log`.
- Hashes are chained using SHA-256 (`prev_hash` $\to$ `row_hash`).
- Table trigger `trg_audit_log_tamper` strictly forbids `UPDATE` and `DELETE` operations on the audit ledger.
- The scheduled script `scripts/verify-audit-chain.mjs` runs in continuous verification to guarantee zero sequence gaps and cryptographic continuity across all clinic tenants.

