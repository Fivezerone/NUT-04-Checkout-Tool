// supabase/functions/_shared/authz.ts
// Re-export of shared ABAC/RBAC policy engine for Edge Functions
export {
  decide,
  toHttpResponse,
  PERMISSIONS,
  CLEARANCE,
  CLINICAL_STAFF,
  STEP_UP,
  audit,
  notifyDpo,
  notifyAuditor,
  flag,
  deny,
  allow,
  isWrite,
  type Action,
  type Subject,
  type Resource,
  type ResourceClass,
  type Obligation,
  type Decision,
  type DecisionAdapters,
} from '../../../src/shared/authz.ts'
